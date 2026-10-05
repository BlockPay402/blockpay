/**
 * Error reasons returned in `invalidReason` / `errorReason`.
 * Generic codes come from x402 v2 §9; `*_sui_*` codes are BlockPay's Sui scheme codes.
 */
export const ErrorReason = {
  // x402 v2
  insufficientFunds: 'insufficient_funds',
  invalidNetwork: 'invalid_network',
  invalidPayload: 'invalid_payload',
  invalidPaymentRequirements: 'invalid_payment_requirements',
  invalidScheme: 'invalid_scheme',
  unsupportedScheme: 'unsupported_scheme',
  invalidX402Version: 'invalid_x402_version',
  invalidTransactionState: 'invalid_transaction_state',
  unexpectedVerifyError: 'unexpected_verify_error',
  unexpectedSettleError: 'unexpected_settle_error',
  settlementPending: 'settlement_pending',

  // exact / Sui
  exactSignature: 'invalid_exact_sui_payload_signature',
  exactSender: 'invalid_exact_sui_payload_sender',
  exactTransaction: 'invalid_exact_sui_payload_transaction',
  exactAmountMismatch: 'invalid_exact_sui_payload_amount_mismatch',
  exactRecipientMismatch: 'invalid_exact_sui_payload_recipient_mismatch',
  exactSponsorPolicy: 'invalid_exact_sui_payload_sponsor_policy',
  exactAlreadySettled: 'invalid_exact_sui_payload_already_settled',
  exactSimulationFailed: 'invalid_exact_sui_payload_simulation_failed',

  // batch-settlement / Sui
  batchChannelNotFound: 'invalid_batch_settlement_sui_channel_not_found',
  batchChannelMismatch: 'invalid_batch_settlement_sui_channel_mismatch',
  batchChannelClosing: 'invalid_batch_settlement_sui_channel_closing',
  batchVoucherSignature: 'invalid_batch_settlement_sui_voucher_signature',
  batchVoucherAmount: 'invalid_batch_settlement_sui_voucher_amount',
  batchVoucherExceedsDeposit: 'invalid_batch_settlement_sui_voucher_exceeds_deposit',
  batchVoucherStale: 'invalid_batch_settlement_sui_voucher_stale',
  batchOpenTransaction: 'invalid_batch_settlement_sui_open_transaction',

  // facilitator policy
  unauthorized: 'unauthorized',
  payToNotAllowed: 'pay_to_not_allowed',
  rejectedByPolicy: 'rejected_by_policy',
  requirementsMismatch: 'payment_requirements_mismatch',
  insufficientPlatformCredit: 'insufficient_platform_credit',
} as const;

export type ErrorReasonCode = (typeof ErrorReason)[keyof typeof ErrorReason];

/** Thrown by clients when a payment would exceed a configured cap. Nothing is signed. */
export class PaymentCapExceededError extends Error {
  override name = 'PaymentCapExceededError';
  constructor(
    message: string,
    readonly details: { amount: string; asset: string; cap: string; scope: string },
  ) {
    super(message);
  }
}

/** Thrown when no `accepts` entry can be paid by this client. */
export class NoSupportedRequirementError extends Error {
  override name = 'NoSupportedRequirementError';
}

/** Thrown when an approval hook declines a payment. */
export class PaymentDeclinedError extends Error {
  override name = 'PaymentDeclinedError';
}
