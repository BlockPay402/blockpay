import {
  BatchSettlementSuiExtraSchema,
  BatchSettlementSuiPayloadSchema,
  type BatchSettlementSuiPayload,
  type BatchVoucher,
  ErrorReason,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResponse,
  type VerifyResponse,
  base64ToBytes,
  bytesToBase64,
  normalizeAddress,
  normalizeCoinType,
} from '@blockpay402/core';
import {
  ChannelOpenedBcs,
  ChannelToppedUpBcs,
  type ParsedTransaction,
  checkSponsorableCommands,
  getChannel,
  parseEventCoinType,
  parseTransaction,
  verifyVoucher,
} from '@blockpay402/sui';
import { isValidTransactionSignature } from '@mysten/sui/verify';
import type { NetworkContext } from '../context.js';
import type { ChannelRecord } from '../store.js';
import {
  EXECUTION_TIMEOUT_MS,
  executionFailureReason,
  isTransientError,
  sponsoredStorageError,
  verbatimSimulation,
} from './errors.js';

type Fail = { ok: false; reason: string; payer?: string };
type Funding = { tx: ParsedTransaction; signature: string; sponsored: boolean; record: ChannelRecord };
type Checked = { ok: true; payer: string; record: ChannelRecord; voucher: BatchVoucher; funding?: Funding };

/**
 * `batch-settlement` on Sui, backed by `blockpay::channel`.
 *
 * verify: check the voucher (and simulate the open/top-up transaction when present).
 * settle: broadcast any open/top-up, then raise the channel watermark off-chain.
 * Value moves later, when the redeemer submits `claim` with the latest voucher.
 */
export class BatchSettlementSuiScheme {
  readonly scheme = 'batch-settlement';

  /** When each channel was last read from chain, to notice payer exits (`request_close`). */
  private readonly refreshedAt = new Map<string, number>();

  constructor(private readonly ctx: NetworkContext) {
    if (!ctx.channel) throw new Error(`batch-settlement needs a channel deployment on ${ctx.network}`);
  }

  get deployment() {
    return this.ctx.channel!;
  }

  async verify(payment: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    const checked = await this.check(payment, requirements);
    if (!checked.ok) return { isValid: false, invalidReason: checked.reason, ...(checked.payer ? { payer: checked.payer } : {}) };
    return { isValid: true, payer: checked.payer };
  }

  async settle(payment: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    const base = { network: requirements.network, transaction: '' } as const;
    const checked = await this.check(payment, requirements);
    if (!checked.ok) return { ...base, success: false, errorReason: checked.reason, payer: checked.payer };
    const { payer, voucher, funding } = checked;
    const extensions: Record<string, unknown> = {};

    if (funding) {
      const executed = await this.executeFunding(funding);
      if (!executed.ok) {
        return { ...base, success: false, errorReason: executed.reason, transaction: executed.digest ?? '', payer };
      }
      extensions.sui = { fundingTransaction: funding.tx.digest };
    }

    const now = Date.now();
    const accepted = await this.ctx.store.acceptVoucher(
      voucher.channelId,
      BigInt(voucher.cumulativeAmount),
      voucher.signature,
      now,
      BigInt(requirements.amount),
    );
    if (!accepted) return { ...base, success: false, errorReason: ErrorReason.batchVoucherStale, payer };

    this.ctx.logger.info('batch.settle.accepted', {
      channelId: voucher.channelId,
      cumulative: voucher.cumulativeAmount,
      amount: requirements.amount,
    });
    return {
      success: true,
      // Commitment identifier: value moves on redemption.
      transaction: `${voucher.channelId}:${voucher.cumulativeAmount}`,
      network: requirements.network,
      payer,
      amount: requirements.amount,
      ...(Object.keys(extensions).length ? { extensions } : {}),
    };
  }

  private async check(payment: PaymentPayload, requirements: PaymentRequirements): Promise<Checked | Fail> {
    const parsed = BatchSettlementSuiPayloadSchema.safeParse(payment.payload);
    if (!parsed.success) return { ok: false, reason: ErrorReason.invalidPayload };
    const extra = BatchSettlementSuiExtraSchema.safeParse(requirements.extra ?? {});
    if (
      !extra.success ||
      normalizeAddress(extra.data.operator) !== normalizeAddress(this.ctx.address) ||
      normalizeAddress(extra.data.channelPackage) !== normalizeAddress(this.deployment.packageId) ||
      normalizeAddress(extra.data.channelRegistry) !== normalizeAddress(this.deployment.registryId)
    ) {
      return { ok: false, reason: ErrorReason.invalidPaymentRequirements };
    }
    const payload = parsed.data as BatchSettlementSuiPayload;
    const channelId = normalizeAddress(payload.channelId);
    const voucher: BatchVoucher = { channelId, cumulativeAmount: payload.cumulativeAmount, signature: payload.signature };

    let record: ChannelRecord | Fail;
    let funding: Funding | undefined;
    if (payload.type === 'voucher') {
      record = await this.loadChannel(channelId, BigInt(payload.cumulativeAmount));
    } else {
      const checkedFunding = await this.checkFunding(payload, requirements);
      if (!checkedFunding.ok) return checkedFunding;
      funding = checkedFunding.funding;
      record = funding.record;
    }
    if ('ok' in record) return record;

    const failure = await this.checkVoucher(record, voucher, requirements);
    if (failure) return { ok: false, reason: failure, payer: record.payer };
    return { ok: true, payer: record.payer, record, voucher, funding };
  }

  private async checkVoucher(
    record: ChannelRecord,
    voucher: BatchVoucher,
    requirements: PaymentRequirements,
  ): Promise<string | null> {
    if (
      normalizeAddress(record.payee) !== normalizeAddress(requirements.payTo) ||
      record.coinType !== normalizeCoinType(requirements.asset) ||
      normalizeAddress(record.operator) !== normalizeAddress(this.ctx.address) ||
      record.network !== requirements.network
    ) {
      return ErrorReason.batchChannelMismatch;
    }
    if (record.status !== 'open') return ErrorReason.batchChannelClosing;
    const cumulative = BigInt(voucher.cumulativeAmount);
    const watermark = BigInt(record.acceptedAmount);
    if (cumulative < watermark + BigInt(requirements.amount) || cumulative <= watermark) {
      return ErrorReason.batchVoucherStale;
    }
    if (cumulative > BigInt(record.deposited)) return ErrorReason.batchVoucherExceedsDeposit;
    const valid = await verifyVoucher({
      authorizer: base64ToBytes(record.authorizer),
      channelId: voucher.channelId,
      cumulativeAmount: cumulative,
      signature: voucher.signature,
    });
    return valid ? null : ErrorReason.batchVoucherSignature;
  }

  /** Channel from the store, refreshed from chain when unknown or when the voucher outruns the known deposit. */
  private async loadChannel(channelId: string, cumulative: bigint): Promise<ChannelRecord | Fail> {
    const cached = await this.ctx.store.getChannel(channelId);
    const fresh = Date.now() - (this.refreshedAt.get(channelId) ?? 0) < this.ctx.channelStateTtlMs;
    if (cached && fresh && cached.status === 'open' && cumulative <= BigInt(cached.deposited)) return cached;
    const onChain = await getChannel(this.ctx.client, channelId, this.deployment.packageId);
    this.refreshedAt.set(channelId, Date.now());
    if (!onChain) {
      if (cached && cached.status !== 'closed') await this.ctx.store.putChannel({ ...cached, status: 'closed' });
      return { ok: false, reason: ErrorReason.batchChannelNotFound };
    }
    const record: ChannelRecord = {
      channelId,
      network: this.ctx.network,
      coinType: onChain.coinType,
      payer: onChain.payer,
      payee: onChain.payee,
      operator: onChain.operator,
      authorizer: bytesToBase64(onChain.authorizer),
      deposited: onChain.deposited.toString(),
      acceptedAmount: cached?.acceptedAmount ?? onChain.claimed.toString(),
      acceptedSignature: cached?.acceptedSignature ?? null,
      claimedAmount: onChain.claimed.toString(),
      closeRequestedAtMs: onChain.closeRequestedAtMs?.toString() ?? null,
      withdrawDelayMs: onChain.withdrawDelayMs.toString(),
      status: onChain.closeRequestedAtMs == null ? 'open' : 'closing',
      lastVoucherAt: cached?.lastVoucherAt ?? null,
      lastClaimAt: cached?.lastClaimAt ?? null,
      lastClaimDigest: cached?.lastClaimDigest ?? null,
      createdAt: cached?.createdAt ?? Date.now(),
    };
    await this.ctx.store.putChannel(record);
    return (await this.ctx.store.getChannel(channelId)) ?? record;
  }

  /** Validate an open/top-up transaction by signature, sponsor policy and simulated events. */
  private async checkFunding(
    payload: Extract<BatchSettlementSuiPayload, { type: 'open' | 'topUp' }>,
    requirements: PaymentRequirements,
  ): Promise<{ ok: true; funding: Funding } | Fail> {
    let tx: ParsedTransaction;
    try {
      tx = await parseTransaction(payload.transaction);
    } catch {
      return { ok: false, reason: ErrorReason.batchOpenTransaction };
    }
    const signed = await isValidTransactionSignature(tx.bytes, payload.transactionSignature, {
      address: tx.sender,
      client: this.ctx.client,
    }).catch(() => false);
    if (!signed) return { ok: false, reason: ErrorReason.exactSignature, payer: tx.sender };

    const sponsored = tx.gasOwner !== tx.sender;
    if (sponsored) {
      const pkg = normalizeAddress(this.deployment.packageId);
      const policyError =
        !this.ctx.sponsor.channels
          ? 'sponsorship disabled'
          : tx.gasOwner !== normalizeAddress(this.ctx.address)
            ? 'gas owner is not this facilitator'
            : tx.gasPayment.length !== 0
              ? 'sponsored gas must come from the address balance'
              : tx.gasBudget > this.ctx.sponsor.maxGasBudget
                ? 'gas budget too high'
                : checkSponsorableCommands(
                    tx.data,
                    [`${pkg}::channel::open`, `${pkg}::channel::top_up`],
                    this.ctx.sponsor.maxCommands,
                  );
      if (policyError) {
        this.ctx.logger.warn('batch.sponsor.rejected', { reason: policyError, payer: tx.sender });
        return { ok: false, reason: ErrorReason.exactSponsorPolicy, payer: tx.sender };
      }
    }
    if (await this.ctx.store.hasTransaction(tx.digest)) {
      return { ok: false, reason: ErrorReason.exactAlreadySettled, payer: tx.sender };
    }

    const simulation = await this.ctx.client.core.simulateTransaction({
      transaction: tx.bytes,
      include: { events: true, effects: true },
      ...verbatimSimulation,
    });
    if (simulation.$kind === 'FailedTransaction') {
      return { ok: false, reason: executionFailureReason(simulation.FailedTransaction.status), payer: tx.sender };
    }
    if (sponsored) {
      const storageError = sponsoredStorageError(simulation.Transaction.effects?.gasUsed, this.ctx.sponsor.maxChannelStorage);
      if (storageError) {
        this.ctx.logger.warn('batch.sponsor.rejected', { reason: storageError, payer: tx.sender });
        return { ok: false, reason: ErrorReason.exactSponsorPolicy, payer: tx.sender };
      }
    }
    const events = simulation.Transaction.events ?? [];
    const channelId = normalizeAddress(payload.channelId);
    const pkg = normalizeAddress(this.deployment.packageId);
    const ofType = (name: string) =>
      events.filter((e) => normalizeAddress(e.packageId) === pkg && e.module === 'channel' && e.eventType.includes(`::channel::${name}<`));

    let record: ChannelRecord;
    if (payload.type === 'open') {
      const event = ofType('ChannelOpened')
        .map((e) => ({ coinType: parseEventCoinType(e.eventType), data: ChannelOpenedBcs.parse(e.bcs) }))
        .find((e) => normalizeAddress(e.data.channel_id) === channelId);
      const extra = BatchSettlementSuiExtraSchema.parse(requirements.extra);
      if (
        !event ||
        event.coinType !== normalizeCoinType(requirements.asset) ||
        normalizeAddress(event.data.payee) !== normalizeAddress(requirements.payTo) ||
        normalizeAddress(event.data.operator) !== normalizeAddress(this.ctx.address) ||
        normalizeAddress(event.data.payer) !== tx.sender ||
        BigInt(event.data.withdraw_delay_ms) < BigInt(extra.withdrawDelayMs)
      ) {
        return { ok: false, reason: ErrorReason.batchOpenTransaction, payer: tx.sender };
      }
      // A sponsored open stores a channel at the sponsor's expense: require a real deposit.
      if (sponsored && extra.minDeposit && BigInt(event.data.deposit) < BigInt(extra.minDeposit)) {
        this.ctx.logger.warn('batch.sponsor.rejected', { reason: 'deposit below minDeposit', payer: tx.sender });
        return { ok: false, reason: ErrorReason.exactSponsorPolicy, payer: tx.sender };
      }
      record = {
        channelId,
        network: this.ctx.network,
        coinType: event.coinType,
        payer: tx.sender,
        payee: normalizeAddress(event.data.payee),
        operator: normalizeAddress(event.data.operator),
        authorizer: bytesToBase64(Uint8Array.from(event.data.authorizer)),
        deposited: event.data.deposit,
        acceptedAmount: '0',
        acceptedSignature: null,
        claimedAmount: '0',
        closeRequestedAtMs: null,
        withdrawDelayMs: event.data.withdraw_delay_ms,
        status: 'open',
        lastVoucherAt: null,
        lastClaimAt: null,
        lastClaimDigest: null,
        createdAt: Date.now(),
      };
    } else {
      const event = ofType('ChannelToppedUp')
        .map((e) => ChannelToppedUpBcs.parse(e.bcs))
        .find((e) => normalizeAddress(e.channel_id) === channelId);
      if (!event) return { ok: false, reason: ErrorReason.batchOpenTransaction, payer: tx.sender };
      const current = await this.loadChannel(channelId, 0n);
      if ('ok' in current) return current;
      record = { ...current, deposited: event.deposited };
    }
    return { ok: true, funding: { tx, signature: payload.transactionSignature, sponsored, record } };
  }

  private async executeFunding(funding: Funding): Promise<{ ok: true } | { ok: false; reason: string; digest?: string }> {
    const { tx, signature, sponsored, record } = funding;
    if (!(await this.ctx.store.reserveTransaction(tx.digest))) {
      return { ok: false, reason: ErrorReason.exactAlreadySettled };
    }
    const signatures = [signature];
    if (sponsored) signatures.push((await this.ctx.signer.signTransaction(tx.bytes)).signature);
    try {
      const result = await this.ctx.client.core.executeTransaction({
        transaction: tx.bytes,
        signatures,
        signal: AbortSignal.timeout(EXECUTION_TIMEOUT_MS),
      });
      if (result.$kind === 'FailedTransaction') {
        return { ok: false, reason: executionFailureReason(result.FailedTransaction.status), digest: tx.digest };
      }
      // Effects are final already, but the channel is read right after (top-ups, claims,
      // client checks): wait until it is checkpointed and readable.
      await this.ctx.client.core.waitForTransaction({ result, timeout: 15_000 });
    } catch (error) {
      if (isTransientError(error)) return { ok: false, reason: ErrorReason.settlementPending, digest: tx.digest };
      await this.ctx.store.releaseTransaction(tx.digest);
      return { ok: false, reason: ErrorReason.invalidTransactionState };
    }
    await this.ctx.store.putChannel(record);
    this.refreshedAt.set(record.channelId, Date.now());
    this.ctx.logger.info('batch.funding.executed', { channelId: record.channelId, digest: tx.digest });
    return { ok: true };
  }
}
