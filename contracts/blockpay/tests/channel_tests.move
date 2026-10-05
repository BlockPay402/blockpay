#[test_only]
module blockpay::channel_tests;

use blockpay::channel::{Self, Channel, Registry};
use sui::balance;
use sui::clock;
use sui::sui::SUI;
use sui::test_scenario::{Self as ts, Scenario};

const ADMIN: address = @0xA;
const PAYER: address = @0xB0B;
const PAYEE: address = @0xCAFE;
const OPERATOR: address = @0xFAC;
const STRANGER: address = @0xBAD;
const NONCE: u64 = 7;
const DELAY_MS: u64 = 900_000;

// Test vectors: Ed25519 key from seed [7u8; 32], channel (PAYER, NONCE) under the test registry.
const AUTHORIZER: vector<u8> = x"ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c";
const CHANNEL_ID: address = @0xf2da499fab28a98b32d0788f8ed85defe9b59ff154c8e3e4d4c6a79fc9646964;
const SIG_300: vector<u8> =
    x"8796c177e6980560c293c5c3a67d81aac4b49da31fedcd6732ef9d8f4d8c10e76fdd253e89c598f0c27e6935a4ed63a96a6f642a5148b514fb3bbd691ae97e0e";
const SIG_700: vector<u8> =
    x"0da9cef07c3fd4a38c38e8eb3d9f812ef8ae501592b991f4e254eac9451e6f4d25c755d502a29f9491272f6ec413fe87b41d099f6511f9358fe9e3a64e42e904";
const SIG_1000: vector<u8> =
    x"2d665aa563c636ada0b3c04b6ed22f1a01f7abcb054b46756ff089f2e5383e1e0f1501a5812f7a88abb8c790dc718074988c0ed767810e7b1f1c440e5b0f5605";
const SIG_1001: vector<u8> =
    x"581fee3198e2f5473d39726594506b0220bfcd90471772ea0cf01f1f8d0b45c9a58a312a8b8bbe2e3e22575cd39c375485c984e20829f9c9c97b14f1fb25260f";
/// Valid signature for 300 over a *different* channel ID.
const SIG_300_OTHER_CHANNEL: vector<u8> =
    x"c5da82bf5c54facb6361750f23f5ad5512ef696e684615dd7d44e29ca9827100016cddb05e93781f96cadc02630adf54828fd9bb9a8ee5705461872c7d993d05";

fun setup(): Scenario {
    let mut s = ts::begin(ADMIN);
    channel::init_for_testing(s.ctx());
    s
}

fun open_channel(s: &mut Scenario, deposit: u64): ID {
    s.next_tx(PAYER);
    let mut registry = s.take_shared<Registry>();
    let id = channel::open(
        &mut registry,
        PAYEE,
        OPERATOR,
        AUTHORIZER,
        DELAY_MS,
        NONCE,
        balance::create_for_testing<SUI>(deposit),
        s.ctx(),
    );
    ts::return_shared(registry);
    id
}

#[test]
fun voucher_message_layout() {
    let message = channel::voucher_message(CHANNEL_ID.to_id(), 300);
    assert!(
        message == x"626c6f636b7061792f6368616e6e656c2f766f75636865722f7631f2da499fab28a98b32d0788f8ed85defe9b59ff154c8e3e4d4c6a79fc96469642c01000000000000",
    );
}

#[test]
fun open_uses_derived_id() {
    let mut s = setup();
    let id = open_channel(&mut s, 1000);
    assert!(id == CHANNEL_ID.to_id());

    s.next_tx(PAYER);
    let registry = s.take_shared<Registry>();
    assert!(channel::channel_id(&registry, PAYER, NONCE) == id);
    ts::return_shared(registry);

    let ch = s.take_shared_by_id<Channel<SUI>>(id);
    assert!(ch.payer() == PAYER);
    assert!(ch.payee() == PAYEE);
    assert!(ch.operator() == OPERATOR);
    assert!(ch.authorizer() == AUTHORIZER);
    assert!(ch.deposited() == 1000);
    assert!(ch.balance() == 1000);
    assert!(ch.claimed() == 0);
    ts::return_shared(ch);
    s.end();
}

#[test]
fun claims_pay_deltas_then_operator_closes() {
    let mut s = setup();
    let id = open_channel(&mut s, 1000);

    s.next_tx(STRANGER); // claim is permissionless
    let mut ch = s.take_shared_by_id<Channel<SUI>>(id);
    ch.claim(300, SIG_300);
    assert!(ch.claimed() == 300 && ch.balance() == 700);
    ch.claim(700, SIG_700);
    assert!(ch.claimed() == 700 && ch.balance() == 300);
    ts::return_shared(ch);

    s.next_tx(OPERATOR);
    let ch = s.take_shared_by_id<Channel<SUI>>(id);
    ch.close(s.ctx());
    let effects = s.next_tx(OPERATOR);
    assert!(effects.deleted().contains(&id));
    s.end();
}

#[test]
fun payee_can_close_after_full_claim() {
    let mut s = setup();
    let id = open_channel(&mut s, 1000);
    s.next_tx(PAYEE);
    let mut ch = s.take_shared_by_id<Channel<SUI>>(id);
    ch.claim(1000, SIG_1000);
    assert!(ch.balance() == 0);
    ch.close(s.ctx());
    s.end();
}

#[test, expected_failure(abort_code = channel::EInvalidSignature)]
fun claim_rejects_voucher_for_other_channel() {
    let mut s = setup();
    let id = open_channel(&mut s, 1000);
    s.next_tx(PAYEE);
    let mut ch = s.take_shared_by_id<Channel<SUI>>(id);
    ch.claim(300, SIG_300_OTHER_CHANNEL);
    abort
}

#[test, expected_failure(abort_code = channel::EInvalidSignature)]
fun claim_rejects_signature_for_other_amount() {
    let mut s = setup();
    let id = open_channel(&mut s, 1000);
    s.next_tx(PAYEE);
    let mut ch = s.take_shared_by_id<Channel<SUI>>(id);
    ch.claim(700, SIG_300);
    abort
}

#[test, expected_failure(abort_code = channel::EAmountNotIncreasing)]
fun claim_rejects_stale_voucher() {
    let mut s = setup();
    let id = open_channel(&mut s, 1000);
    s.next_tx(PAYEE);
    let mut ch = s.take_shared_by_id<Channel<SUI>>(id);
    ch.claim(700, SIG_700);
    ch.claim(300, SIG_300);
    abort
}

#[test, expected_failure(abort_code = channel::EAmountExceedsDeposit)]
fun claim_rejects_amount_above_deposit() {
    let mut s = setup();
    let id = open_channel(&mut s, 1000);
    s.next_tx(PAYEE);
    let mut ch = s.take_shared_by_id<Channel<SUI>>(id);
    ch.claim(1001, SIG_1001);
    abort
}

#[test]
fun top_up_raises_ceiling() {
    let mut s = setup();
    let id = open_channel(&mut s, 1000);
    s.next_tx(PAYER);
    let mut ch = s.take_shared_by_id<Channel<SUI>>(id);
    ch.top_up(balance::create_for_testing<SUI>(1));
    assert!(ch.deposited() == 1001);
    ch.claim(1001, SIG_1001);
    assert!(ch.balance() == 0);
    ts::return_shared(ch);
    s.end();
}

#[test, expected_failure(abort_code = channel::ENotPayeeOrOperator)]
fun stranger_cannot_close() {
    let mut s = setup();
    let id = open_channel(&mut s, 1000);
    s.next_tx(STRANGER);
    let ch = s.take_shared_by_id<Channel<SUI>>(id);
    ch.close(s.ctx());
    abort
}

#[test, expected_failure(abort_code = channel::ENotPayer)]
fun only_payer_requests_close() {
    let mut s = setup();
    let id = open_channel(&mut s, 1000);
    s.next_tx(PAYEE);
    let mut ch = s.take_shared_by_id<Channel<SUI>>(id);
    let clock = clock::create_for_testing(s.ctx());
    ch.request_close(&clock, s.ctx());
    abort
}

#[test]
fun payer_withdraws_after_delay_and_payee_can_claim_meanwhile() {
    let mut s = setup();
    let id = open_channel(&mut s, 1000);
    s.next_tx(PAYER);
    let mut clock = clock::create_for_testing(s.ctx());
    clock.set_for_testing(1_000);
    let mut ch = s.take_shared_by_id<Channel<SUI>>(id);
    ch.request_close(&clock, s.ctx());
    assert!(ch.close_requested_at_ms() == option::some(1_000));

    // The payee still redeems its latest voucher during the delay.
    ch.claim(300, SIG_300);
    clock.set_for_testing(1_000 + DELAY_MS);
    ch.withdraw(&clock, s.ctx());
    clock.destroy_for_testing();
    let effects = s.next_tx(PAYER);
    assert!(effects.deleted().contains(&id));
    s.end();
}

#[test, expected_failure(abort_code = channel::EWithdrawDelayNotElapsed)]
fun withdraw_waits_for_delay() {
    let mut s = setup();
    let id = open_channel(&mut s, 1000);
    s.next_tx(PAYER);
    let mut clock = clock::create_for_testing(s.ctx());
    let mut ch = s.take_shared_by_id<Channel<SUI>>(id);
    ch.request_close(&clock, s.ctx());
    clock.set_for_testing(DELAY_MS - 1);
    ch.withdraw(&clock, s.ctx());
    abort
}

#[test, expected_failure(abort_code = channel::ECloseNotRequested)]
fun withdraw_requires_close_request() {
    let mut s = setup();
    let id = open_channel(&mut s, 1000);
    s.next_tx(PAYER);
    let clock = clock::create_for_testing(s.ctx());
    let ch = s.take_shared_by_id<Channel<SUI>>(id);
    ch.withdraw(&clock, s.ctx());
    abort
}

#[test, expected_failure(abort_code = channel::EChannelClosing)]
fun top_up_rejected_while_closing() {
    let mut s = setup();
    let id = open_channel(&mut s, 1000);
    s.next_tx(PAYER);
    let clock = clock::create_for_testing(s.ctx());
    let mut ch = s.take_shared_by_id<Channel<SUI>>(id);
    ch.request_close(&clock, s.ctx());
    ch.top_up(balance::create_for_testing<SUI>(1));
    abort
}

#[test, expected_failure(abort_code = sui::derived_object::EObjectAlreadyExists)]
fun nonce_cannot_be_reused() {
    let mut s = setup();
    let id = open_channel(&mut s, 1000);
    // Even after the channel is gone, its ID stays claimed.
    s.next_tx(PAYEE);
    let mut ch = s.take_shared_by_id<Channel<SUI>>(id);
    ch.claim(1000, SIG_1000);
    ch.close(s.ctx());
    open_channel(&mut s, 1000);
    abort
}

#[test, expected_failure(abort_code = channel::EInvalidPublicKey)]
fun rejects_bad_authorizer() {
    let mut s = setup();
    s.next_tx(PAYER);
    let mut registry = s.take_shared<Registry>();
    channel::open(&mut registry, PAYEE, OPERATOR, x"01", DELAY_MS, NONCE, balance::create_for_testing<SUI>(1), s.ctx());
    abort
}

#[test, expected_failure(abort_code = channel::EInvalidWithdrawDelay)]
fun rejects_short_delay() {
    let mut s = setup();
    s.next_tx(PAYER);
    let mut registry = s.take_shared<Registry>();
    channel::open(&mut registry, PAYEE, OPERATOR, AUTHORIZER, 1_000, NONCE, balance::create_for_testing<SUI>(1), s.ctx());
    abort
}

#[test, expected_failure(abort_code = channel::EZeroAmount)]
fun rejects_empty_deposit() {
    let mut s = setup();
    s.next_tx(PAYER);
    let mut registry = s.take_shared<Registry>();
    channel::open(&mut registry, PAYEE, OPERATOR, AUTHORIZER, DELAY_MS, NONCE, balance::zero<SUI>(), s.ctx());
    abort
}
