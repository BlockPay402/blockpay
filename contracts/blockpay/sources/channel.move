// Copyright (c) BlockPay contributors
// SPDX-License-Identifier: Apache-2.0

/// Payment channels for the x402 `batch-settlement` scheme on Sui.
///
/// A payer escrows `Balance<T>` in a shared `Channel<T>` bound to one payee and
/// one voucher key (`authorizer`). For every paid request the payer's voucher key
/// signs a *cumulative* amount off-chain; the payee (or anyone holding the latest
/// voucher) redeems it on-chain with `claim`, which pays only the delta since the
/// previous claim. Funds can only ever move to `payee` (claims) or back to `payer`
/// (close / withdraw), so neither the facilitator nor the voucher key can redirect
/// them.
///
/// Channel IDs are derived from a shared `Registry` and `(payer, nonce)`, so a
/// client can compute the ID - and sign its first voucher - before the opening
/// transaction executes. A derived ID can never be claimed twice, even after the
/// channel is deleted, so vouchers cannot be replayed against a later channel.
///
/// `open` needs `&mut Registry`, so every open is sequenced through the registry it
/// uses. To keep one hot shared object from limiting how fast channels can open,
/// `init` creates `REGISTRY_SHARDS` registries; clients spread payers across them
/// (any shard is valid, the client just has to use the same one to derive the ID).
module blockpay::channel;

use sui::balance::{Self, Balance};
use sui::bcs;
use sui::clock::Clock;
use sui::derived_object;
use sui::ed25519;
use sui::event;

// === Errors ===

#[error(code = 0)]
const ENotPayer: vector<u8> = b"Only the payer can perform this action";
#[error(code = 1)]
const ENotPayeeOrOperator: vector<u8> = b"Only the payee or operator can perform this action";
#[error(code = 2)]
const EInvalidSignature: vector<u8> = b"Voucher signature is invalid";
#[error(code = 3)]
const EAmountNotIncreasing: vector<u8> = b"Voucher amount must exceed the claimed amount";
#[error(code = 4)]
const EAmountExceedsDeposit: vector<u8> = b"Voucher amount exceeds the channel deposit";
#[error(code = 5)]
const EInvalidPublicKey: vector<u8> = b"Authorizer must be a 32-byte Ed25519 public key";
#[error(code = 6)]
const EInvalidWithdrawDelay: vector<u8> = b"Withdraw delay is out of range";
#[error(code = 7)]
const ECloseNotRequested: vector<u8> = b"Payer has not requested to close the channel";
#[error(code = 8)]
const EWithdrawDelayNotElapsed: vector<u8> = b"Withdraw delay has not elapsed";
#[error(code = 9)]
const EZeroAmount: vector<u8> = b"Amount must be greater than zero";
#[error(code = 10)]
const EChannelClosing: vector<u8> = b"Channel is closing";

// === Constants ===

/// Domain separator prepended to every voucher message.
const VOUCHER_DOMAIN: vector<u8> = b"blockpay/channel/voucher/v1";
/// 15 minutes. Gives the payee time to claim after the payer requests a close.
const MIN_WITHDRAW_DELAY_MS: u64 = 900_000;
/// 30 days.
const MAX_WITHDRAW_DELAY_MS: u64 = 2_592_000_000;
const ED25519_PUBLIC_KEY_LENGTH: u64 = 32;
/// Registries created at publish time. Opens on different shards do not contend.
const REGISTRY_SHARDS: u64 = 16;

// === Structs ===

/// Shared parent that namespaces channel IDs. One of `REGISTRY_SHARDS`.
public struct Registry has key {
    id: UID,
    shard: u64,
}

/// Key a channel ID is derived from. Unique per payer and nonce.
public struct ChannelKey has copy, drop, store {
    payer: address,
    nonce: u64,
}

public struct Channel<phantom T> has key {
    id: UID,
    payer: address,
    /// Receives every claim. Normally the merchant's `payTo` address.
    payee: address,
    /// May cooperatively close the channel on the payee's behalf (the facilitator).
    operator: address,
    /// Ed25519 public key that signs vouchers.
    authorizer: vector<u8>,
    funds: Balance<T>,
    /// Total ever deposited.
    deposited: u64,
    /// Cumulative amount already paid to `payee`.
    claimed: u64,
    withdraw_delay_ms: u64,
    close_requested_at_ms: Option<u64>,
}

// === Events ===

/// Emitted once per shard at publish time, so deployments can list registries in shard order.
public struct RegistryCreated has copy, drop {
    registry_id: ID,
    shard: u64,
}

public struct ChannelOpened<phantom T> has copy, drop {
    channel_id: ID,
    payer: address,
    payee: address,
    operator: address,
    authorizer: vector<u8>,
    nonce: u64,
    deposit: u64,
    withdraw_delay_ms: u64,
}

public struct ChannelToppedUp<phantom T> has copy, drop {
    channel_id: ID,
    amount: u64,
    deposited: u64,
}

public struct ChannelClaimed<phantom T> has copy, drop {
    channel_id: ID,
    payee: address,
    amount: u64,
    claimed: u64,
}

public struct ChannelCloseRequested<phantom T> has copy, drop {
    channel_id: ID,
    requested_at_ms: u64,
    withdrawable_at_ms: u64,
}

public struct ChannelClosed<phantom T> has copy, drop {
    channel_id: ID,
    claimed: u64,
    refunded: u64,
}

fun init(ctx: &mut TxContext) {
    create_registries(REGISTRY_SHARDS, ctx);
}

fun create_registries(count: u64, ctx: &mut TxContext) {
    let mut shard = 0;
    while (shard < count) {
        let id = object::new(ctx);
        event::emit(RegistryCreated { registry_id: id.to_inner(), shard });
        transfer::share_object(Registry { id, shard });
        shard = shard + 1;
    };
}

// === Payer ===

/// Open a channel funded with `deposit`. The sender becomes the payer.
public fun open<T>(
    registry: &mut Registry,
    payee: address,
    operator: address,
    authorizer: vector<u8>,
    withdraw_delay_ms: u64,
    nonce: u64,
    deposit: Balance<T>,
    ctx: &mut TxContext,
): ID {
    assert!(authorizer.length() == ED25519_PUBLIC_KEY_LENGTH, EInvalidPublicKey);
    assert!(
        withdraw_delay_ms >= MIN_WITHDRAW_DELAY_MS && withdraw_delay_ms <= MAX_WITHDRAW_DELAY_MS,
        EInvalidWithdrawDelay,
    );
    let amount = deposit.value();
    assert!(amount > 0, EZeroAmount);

    let payer = ctx.sender();
    let id = derived_object::claim(&mut registry.id, ChannelKey { payer, nonce });
    let channel_id = id.to_inner();

    event::emit(ChannelOpened<T> {
        channel_id,
        payer,
        payee,
        operator,
        authorizer,
        nonce,
        deposit: amount,
        withdraw_delay_ms,
    });

    transfer::share_object(Channel<T> {
        id,
        payer,
        payee,
        operator,
        authorizer,
        funds: deposit,
        deposited: amount,
        claimed: 0,
        withdraw_delay_ms,
        close_requested_at_ms: option::none(),
    });
    channel_id
}

/// Add funds to an open channel. Anyone may top up; unspent funds return to the payer.
public fun top_up<T>(channel: &mut Channel<T>, funds: Balance<T>) {
    assert!(channel.close_requested_at_ms.is_none(), EChannelClosing);
    let amount = funds.value();
    assert!(amount > 0, EZeroAmount);
    channel.funds.join(funds);
    channel.deposited = channel.deposited + amount;
    event::emit(ChannelToppedUp<T> {
        channel_id: channel.id.to_inner(),
        amount,
        deposited: channel.deposited,
    });
}

/// Start the unilateral exit. The payee can keep claiming until `withdraw` runs.
public fun request_close<T>(channel: &mut Channel<T>, clock: &Clock, ctx: &TxContext) {
    assert!(ctx.sender() == channel.payer, ENotPayer);
    if (channel.close_requested_at_ms.is_some()) return;
    let now = clock.timestamp_ms();
    channel.close_requested_at_ms = option::some(now);
    event::emit(ChannelCloseRequested<T> {
        channel_id: channel.id.to_inner(),
        requested_at_ms: now,
        withdrawable_at_ms: now + channel.withdraw_delay_ms,
    });
}

/// Finish the unilateral exit once the delay has elapsed: refund the payer and delete the channel.
public fun withdraw<T>(channel: Channel<T>, clock: &Clock, ctx: &TxContext) {
    assert!(ctx.sender() == channel.payer, ENotPayer);
    assert!(channel.close_requested_at_ms.is_some(), ECloseNotRequested);
    let requested_at = *channel.close_requested_at_ms.borrow();
    assert!(clock.timestamp_ms() >= requested_at + channel.withdraw_delay_ms, EWithdrawDelayNotElapsed);
    destroy(channel);
}

// === Payee / operator ===

/// Redeem a voucher for `cumulative`, paying `cumulative - claimed` to the payee.
/// Permissionless: funds can only go to the payee.
public fun claim<T>(channel: &mut Channel<T>, cumulative: u64, signature: vector<u8>) {
    assert!(cumulative > channel.claimed, EAmountNotIncreasing);
    assert!(cumulative <= channel.deposited, EAmountExceedsDeposit);
    let message = voucher_message(channel.id.to_inner(), cumulative);
    assert!(ed25519::ed25519_verify(&signature, &channel.authorizer, &message), EInvalidSignature);

    let amount = cumulative - channel.claimed;
    channel.claimed = cumulative;
    balance::send_funds(channel.funds.split(amount), channel.payee);
    event::emit(ChannelClaimed<T> {
        channel_id: channel.id.to_inner(),
        payee: channel.payee,
        amount,
        claimed: cumulative,
    });
}

/// Cooperative close: refund the unspent deposit to the payer and delete the channel.
/// Call `claim` first in the same transaction to redeem the final voucher.
public fun close<T>(channel: Channel<T>, ctx: &TxContext) {
    let sender = ctx.sender();
    assert!(sender == channel.payee || sender == channel.operator, ENotPayeeOrOperator);
    destroy(channel);
}

// === Views ===

/// The exact bytes a voucher key signs: domain || bcs(channel_id) || bcs(cumulative).
public fun voucher_message(channel_id: ID, cumulative: u64): vector<u8> {
    let mut message = VOUCHER_DOMAIN;
    message.append(bcs::to_bytes(&channel_id));
    message.append(bcs::to_bytes(&cumulative));
    message
}

/// The ID a channel opened by `payer` with `nonce` will have.
public fun channel_id(registry: &Registry, payer: address, nonce: u64): ID {
    derived_object::derive_address(registry.id.to_inner(), ChannelKey { payer, nonce }).to_id()
}

/// Which of the `REGISTRY_SHARDS` registries this is.
public fun shard(registry: &Registry): u64 { registry.shard }

public fun registry_shards(): u64 { REGISTRY_SHARDS }

public fun payer<T>(channel: &Channel<T>): address { channel.payer }

public fun payee<T>(channel: &Channel<T>): address { channel.payee }

public fun operator<T>(channel: &Channel<T>): address { channel.operator }

public fun authorizer<T>(channel: &Channel<T>): vector<u8> { channel.authorizer }

public fun balance<T>(channel: &Channel<T>): u64 { channel.funds.value() }

public fun deposited<T>(channel: &Channel<T>): u64 { channel.deposited }

public fun claimed<T>(channel: &Channel<T>): u64 { channel.claimed }

public fun withdraw_delay_ms<T>(channel: &Channel<T>): u64 { channel.withdraw_delay_ms }

public fun close_requested_at_ms<T>(channel: &Channel<T>): Option<u64> {
    channel.close_requested_at_ms
}

// === Internal ===

fun destroy<T>(channel: Channel<T>) {
    let Channel {
        id,
        payer,
        payee: _,
        operator: _,
        authorizer: _,
        funds,
        deposited: _,
        claimed,
        withdraw_delay_ms: _,
        close_requested_at_ms: _,
    } = channel;
    let refunded = funds.value();
    event::emit(ChannelClosed<T> { channel_id: id.to_inner(), claimed, refunded });
    if (refunded > 0) balance::send_funds(funds, payer) else funds.destroy_zero();
    id.delete();
}

/// Creates only shard 0, so tests can `take_shared<Registry>()` it (and the shared test vectors,
/// derived from the first registry created, stay valid).
#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    create_registries(1, ctx);
}

/// The real `init`: all `REGISTRY_SHARDS` registries.
#[test_only]
public fun init_all_shards_for_testing(ctx: &mut TxContext) {
    init(ctx);
}
