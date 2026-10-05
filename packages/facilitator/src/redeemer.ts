import { type ClaimInput, buildClaimTransaction, getChannel } from '@blockpay402/sui';
import type { NetworkContext } from './context.js';
import type { ChannelRecord } from './store.js';

export interface RedeemPolicy {
  /** How often to look for vouchers to redeem. Default 60s. */
  intervalMs: number;
  /** Redeem once a channel's unredeemed value reaches this many atomic units. Default 0 (any). */
  minAmount: bigint;
  /** Redeem a voucher no later than this after accepting it. Keep well below the 15-minute minimum withdraw delay. Default 5 min. */
  maxAgeMs: number;
  /** Cooperatively close channels with no vouchers for this long, refunding the payer. 0 disables. Default 0. */
  closeIdleAfterMs: number;
  /** Claims per transaction. Default 50. */
  batchSize: number;
}

export const defaultRedeemPolicy: RedeemPolicy = {
  intervalMs: 60_000,
  minAmount: 0n,
  maxAgeMs: 5 * 60_000,
  closeIdleAfterMs: 0,
  batchSize: 50,
};

export interface RedeemResult {
  digest: string;
  claims: Array<{ channelId: string; cumulativeAmount: string; closed: boolean }>;
}

/** Turns accepted vouchers into on-chain `claim` calls, paid for by the operator. */
export class Redeemer {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly ctx: NetworkContext,
    private readonly policy: RedeemPolicy,
    private readonly onRedeemed?: (result: RedeemResult) => void | Promise<void>,
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runOnce().catch(() => {}), this.policy.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Redeem what is due now. With `force`, redeem every channel with unredeemed value. */
  async runOnce(options: { force?: boolean; channelIds?: string[] } = {}): Promise<RedeemResult[]> {
    if (this.running || !this.ctx.channel) return [];
    this.running = true;
    try {
      const now = Date.now();
      let candidates = await this.ctx.store.listRedeemable(this.ctx.network);
      if (options.channelIds) {
        const wanted = new Set(options.channelIds);
        candidates = candidates.filter((c) => wanted.has(c.channelId));
      }
      const due: Array<ChannelRecord & { close: boolean }> = [];
      for (const record of candidates) {
        const close =
          this.policy.closeIdleAfterMs > 0 && now - (record.lastVoucherAt ?? record.createdAt) >= this.policy.closeIdleAfterMs;
        if (options.force || close || (await this.isDue(record, now))) due.push({ ...record, close });
      }
      const results: RedeemResult[] = [];
      for (let i = 0; i < due.length; i += this.policy.batchSize) {
        const result = await this.redeem(due.slice(i, i + this.policy.batchSize));
        if (result) results.push(result);
      }
      return results;
    } finally {
      this.running = false;
    }
  }

  private async isDue(record: ChannelRecord, now: number): Promise<boolean> {
    const unredeemed = BigInt(record.acceptedAmount) - BigInt(record.claimedAmount);
    if (unredeemed <= 0n) return false;
    if (unredeemed >= this.policy.minAmount) return true;
    if (now - (record.lastVoucherAt ?? now) >= this.policy.maxAgeMs) return true;
    // A payer exit gives us only the withdraw delay to claim: check chain for a close request.
    const onChain = await getChannel(this.ctx.client, record.channelId);
    return onChain?.closeRequestedAtMs != null;
  }

  private async redeem(records: Array<ChannelRecord & { close: boolean }>): Promise<RedeemResult | null> {
    const claims: ClaimInput[] = records
      .filter((r) => r.acceptedSignature)
      .map((r) => ({
        channelId: r.channelId,
        coinType: r.coinType,
        cumulativeAmount: r.acceptedAmount,
        signature: r.acceptedSignature!,
        close: r.close,
      }));
    if (claims.length === 0) return null;
    const tx = buildClaimTransaction(this.ctx.channel!, claims);
    tx.setSender(this.ctx.address);
    try {
      const result = await this.ctx.client.core.signAndExecuteTransaction({ transaction: tx, signer: this.ctx.signer });
      if (result.$kind === 'FailedTransaction') {
        this.ctx.logger.error('redeem.failed', { digest: result.FailedTransaction.digest, channels: claims.length });
        // One bad channel (e.g. already withdrawn) fails the batch: retry individually next time.
        if (claims.length > 1) for (const r of records) await this.redeem([r]);
        else await this.markGoneIfClosed(records[0]!);
        return null;
      }
      const digest = result.Transaction.digest;
      const now = Date.now();
      for (const claim of claims) {
        await this.ctx.store.markClaimed(claim.channelId, BigInt(claim.cumulativeAmount), digest, !!claim.close, now);
      }
      const redeemed: RedeemResult = {
        digest,
        claims: claims.map((c) => ({ channelId: c.channelId, cumulativeAmount: String(c.cumulativeAmount), closed: !!c.close })),
      };
      this.ctx.logger.info('redeem.succeeded', { digest, channels: claims.length });
      await this.onRedeemed?.(redeemed);
      return redeemed;
    } catch (error) {
      this.ctx.logger.error('redeem.error', { error: String(error) });
      return null;
    }
  }

  private async markGoneIfClosed(record: ChannelRecord) {
    const onChain = await getChannel(this.ctx.client, record.channelId).catch(() => undefined);
    if (onChain === null) await this.ctx.store.putChannel({ ...record, status: 'closed' });
  }
}
