import {
  ErrorReason,
  ExactSuiPayloadSchema,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResponse,
  type VerifyResponse,
  normalizeAddress,
  normalizeCoinType,
} from '@blockpay402/core';
import { type ParsedTransaction, checkSponsorableCommands, parseTransaction } from '@blockpay402/sui';
import { isValidTransactionSignature } from '@mysten/sui/verify';
import type { NetworkContext } from '../context.js';
import {
  EXECUTION_TIMEOUT_MS,
  executionFailureReason,
  isTransientError,
  sponsoredStorageError,
  verbatimSimulation,
} from './errors.js';

type Simulation = Awaited<ReturnType<NetworkContext['client']['core']['simulateTransaction']>>;

interface Checked {
  tx: ParsedTransaction;
  signature: string;
  sponsored: boolean;
  /** Present for sponsored payments, which are always simulated before the sponsor co-signs. */
  simulation?: Simulation;
}

type CheckResult = { ok: true; value: Checked } | { ok: false; reason: string; payer?: string };

/**
 * `exact` on Sui: the payload is a complete transaction signed by the payer.
 * The facilitator can only broadcast it as signed, so it cannot redirect funds.
 */
export class ExactSuiScheme {
  readonly scheme = 'exact';

  constructor(private readonly ctx: NetworkContext) {}

  async verify(payment: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    const checked = await this.check(payment);
    if (!checked.ok) return invalid(checked.reason, checked.payer);
    const { tx } = checked.value;

    if (await this.ctx.store.hasTransaction(tx.digest)) return invalid(ErrorReason.exactAlreadySettled, tx.sender);

    const simulation = checked.value.simulation ?? (await this.simulate(tx));
    if (simulation.$kind === 'FailedTransaction') {
      return invalid(executionFailureReason(simulation.FailedTransaction.status), tx.sender);
    }
    const received = amountReceived(simulation.Transaction.balanceChanges ?? [], requirements);
    if (received !== BigInt(requirements.amount)) {
      const reason = received === 0n ? ErrorReason.exactRecipientMismatch : ErrorReason.exactAmountMismatch;
      return invalid(reason, tx.sender);
    }
    return { isValid: true, payer: tx.sender };
  }

  async settle(payment: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    const base = { network: requirements.network, transaction: '' } as const;
    const checked = await this.check(payment);
    if (!checked.ok) return { ...base, success: false, errorReason: checked.reason, payer: checked.payer };
    const { tx, signature, sponsored } = checked.value;
    const payer = tx.sender;

    // A signed transaction executes at most once on-chain, but re-submitting it returns the
    // original effects. Reserve the digest so one payment can never settle two requests.
    if (!(await this.ctx.store.reserveTransaction(tx.digest))) {
      return { ...base, success: false, errorReason: ErrorReason.exactAlreadySettled, payer };
    }

    const signatures = [signature];
    if (sponsored) signatures.push((await this.ctx.signer.signTransaction(tx.bytes)).signature);

    let result;
    try {
      result = await this.ctx.client.core.executeTransaction({
        transaction: tx.bytes,
        signatures,
        include: { balanceChanges: true },
        signal: AbortSignal.timeout(EXECUTION_TIMEOUT_MS),
      });
    } catch (error) {
      if (isTransientError(error)) {
        // Broadcast may have landed: keep the reservation and let the caller reconcile.
        this.ctx.logger.warn('exact.settle.pending', { digest: tx.digest, error: String(error) });
        return { ...base, success: false, errorReason: ErrorReason.settlementPending, transaction: tx.digest, payer };
      }
      await this.ctx.store.releaseTransaction(tx.digest);
      this.ctx.logger.warn('exact.settle.rejected', { digest: tx.digest, error: String(error) });
      return { ...base, success: false, errorReason: ErrorReason.invalidTransactionState, payer };
    }

    if (result.$kind === 'FailedTransaction') {
      return {
        ...base,
        success: false,
        errorReason: executionFailureReason(result.FailedTransaction.status),
        transaction: result.FailedTransaction.digest,
        payer,
      };
    }
    const received = amountReceived(result.Transaction.balanceChanges ?? [], requirements);
    if (received !== BigInt(requirements.amount)) {
      this.ctx.logger.error('exact.settle.amount_mismatch', { digest: tx.digest, received: received.toString() });
      return { ...base, success: false, errorReason: ErrorReason.exactAmountMismatch, transaction: tx.digest, payer };
    }
    this.ctx.logger.info('exact.settle.succeeded', { digest: tx.digest, payer, amount: requirements.amount });
    return { success: true, transaction: tx.digest, network: requirements.network, payer, amount: requirements.amount };
  }

  /** Stateless checks shared by verify and settle: shape, signature, sponsorship policy. */
  private async check(payment: PaymentPayload): Promise<CheckResult> {
    const parsed = ExactSuiPayloadSchema.safeParse(payment.payload);
    if (!parsed.success) return { ok: false, reason: ErrorReason.invalidPayload };

    let tx: ParsedTransaction;
    try {
      tx = await parseTransaction(parsed.data.transaction);
    } catch {
      return { ok: false, reason: ErrorReason.exactTransaction };
    }

    const validSignature = await isValidTransactionSignature(tx.bytes, parsed.data.signature, {
      address: tx.sender,
      client: this.ctx.client,
    }).catch(() => false);
    if (!validSignature) return { ok: false, reason: ErrorReason.exactSignature, payer: tx.sender };

    const sponsored = tx.gasOwner !== tx.sender;
    if (sponsored) {
      const policyError = this.sponsorPolicyError(tx);
      if (policyError) {
        this.ctx.logger.warn('exact.sponsor.rejected', { reason: policyError, payer: tx.sender });
        return { ok: false, reason: ErrorReason.exactSponsorPolicy, payer: tx.sender };
      }
    }
    if (!sponsored) return { ok: true, value: { tx, signature: parsed.data.signature, sponsored } };

    // Checked on settle too: a resource server may call /settle without /verify.
    const simulation = await this.simulate(tx);
    if (simulation.$kind === 'Transaction') {
      const storageError = sponsoredStorageError(simulation.Transaction.effects?.gasUsed, this.ctx.sponsor.maxExactStorage);
      if (storageError) {
        this.ctx.logger.warn('exact.sponsor.rejected', { reason: storageError, payer: tx.sender });
        return { ok: false, reason: ErrorReason.exactSponsorPolicy, payer: tx.sender };
      }
    }
    return { ok: true, value: { tx, signature: parsed.data.signature, sponsored, simulation } };
  }

  private simulate(tx: ParsedTransaction) {
    return this.ctx.client.core.simulateTransaction({
      transaction: tx.bytes,
      include: { balanceChanges: true, effects: true },
      ...verbatimSimulation,
    });
  }

  private sponsorPolicyError(tx: ParsedTransaction): string | null {
    if (!this.ctx.sponsor.exact) return 'sponsorship disabled';
    if (tx.gasOwner !== normalizeAddress(this.ctx.address)) return 'gas owner is not this facilitator';
    if (tx.gasPayment.length !== 0) return 'sponsored gas must come from the address balance';
    if (tx.gasBudget > this.ctx.sponsor.maxGasBudget) return 'gas budget too high';
    return checkSponsorableCommands(tx.data, [], this.ctx.sponsor.maxCommands);
  }
}

function amountReceived(
  changes: ReadonlyArray<{ address: string; coinType: string; amount: string }>,
  requirements: PaymentRequirements,
): bigint {
  const payTo = normalizeAddress(requirements.payTo);
  const asset = normalizeCoinType(requirements.asset);
  return changes
    .filter((c) => normalizeAddress(c.address) === payTo && normalizeCoinType(c.coinType) === asset)
    .reduce((sum, c) => sum + BigInt(c.amount), 0n);
}

function invalid(reason: string, payer?: string): VerifyResponse {
  return { isValid: false, invalidReason: reason, ...(payer ? { payer } : {}) };
}
