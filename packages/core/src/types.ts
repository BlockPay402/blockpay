/**
 * x402 protocol v2 types (https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md)
 * plus the Sui scheme payloads BlockPay implements.
 */

export const X402_VERSION = 2 as const;

/** CAIP-2 network identifier, e.g. `sui:mainnet`. */
export type Network = `${string}:${string}`;
export type SuiNetwork = 'sui:mainnet' | 'sui:testnet' | 'sui:devnet' | 'sui:localnet';

export type Scheme = 'exact' | 'batch-settlement' | (string & {});

export interface ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
  serviceName?: string;
  tags?: string[];
  iconUrl?: string;
}

export interface PaymentRequirements<Extra extends object = Record<string, unknown>> {
  scheme: Scheme;
  network: Network;
  /** Amount in the asset's smallest unit. */
  amount: string;
  /** Fully-qualified Sui coin type, e.g. `0x…::usdc::USDC`. */
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Extra;
}

export interface PaymentRequired {
  x402Version: typeof X402_VERSION;
  error?: string;
  resource: ResourceInfo;
  accepts: PaymentRequirements[];
  extensions?: Record<string, unknown>;
}

export interface PaymentPayload<P = unknown> {
  x402Version: typeof X402_VERSION;
  resource?: ResourceInfo;
  accepted: PaymentRequirements;
  payload: P;
  extensions?: Record<string, unknown>;
}

export interface VerifyRequest {
  x402Version: typeof X402_VERSION;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

export type SettleRequest = VerifyRequest;

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
  extra?: Record<string, unknown>;
}

export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  payer?: string;
  /**
   * Transaction digest for on-chain settlement. For `batch-settlement` this is the
   * commitment identifier `<channelId>:<cumulativeAmount>` (value moves at redemption).
   */
  transaction: string;
  network: Network;
  amount?: string;
  extensions?: Record<string, unknown>;
}

export interface SupportedKind {
  x402Version: typeof X402_VERSION;
  scheme: Scheme;
  network: Network;
  extra?: Record<string, unknown>;
}

export interface SupportedResponse {
  kinds: SupportedKind[];
  extensions: string[];
  signers: Record<string, string[]>;
}

/** The facilitator surface a resource server needs. Implemented over HTTP or in-process. */
export interface FacilitatorClient {
  verify(request: VerifyRequest): Promise<VerifyResponse>;
  settle(request: SettleRequest): Promise<SettleResponse>;
  supported(): Promise<SupportedResponse>;
}

// --- Sui `exact` scheme -----------------------------------------------------

/** `payload` of an `exact` payment on Sui: a complete transaction signed by the payer. */
export interface ExactSuiPayload {
  /** Base64 BCS `TransactionData`. */
  transaction: string;
  /** Base64 Sui signature of the payer over `transaction`. */
  signature: string;
}

/** `extra` a facilitator adds to `exact` requirements on Sui. */
export interface ExactSuiExtra {
  /** Address that sponsors gas from its address balance. Absent: the payer pays gas (or it is gasless). */
  feePayer?: string;
  /** True when the network transfers `asset` gaslessly at this amount, so no sponsor is needed. */
  gasless?: boolean;
}

// --- Sui `batch-settlement` scheme -----------------------------------------

export interface BatchSettlementSuiExtra {
  /** Address allowed to cooperatively close channels for the payee (the facilitator). */
  operator: string;
  /** `blockpay::channel` package and registry for this network. */
  channelPackage: string;
  channelRegistry: string;
  /** Delay the payer must wait between `request_close` and `withdraw`. */
  withdrawDelayMs: number;
  /** Suggested deposit when opening a channel, in atomic units. */
  minDeposit?: string;
  /** Sponsor for open/top-up transactions. Absent: the payer pays gas. */
  feePayer?: string;
}

export interface BatchVoucher {
  channelId: string;
  /** Running total authorized on this channel, in atomic units. */
  cumulativeAmount: string;
  /** Base64 Ed25519 signature by the channel authorizer over the voucher message. */
  signature: string;
}

export type BatchSettlementSuiPayload =
  | ({ type: 'voucher' } & BatchVoucher)
  | ({
      /** Open (or top up) the channel, then apply the voucher. */
      type: 'open' | 'topUp';
      /** Base64 BCS `TransactionData` signed by the payer. */
      transaction: string;
      transactionSignature: string;
    } & BatchVoucher);
