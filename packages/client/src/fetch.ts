import {
  HEADERS,
  type PaymentRequired,
  PaymentRequiredSchema,
  type SettleResponse,
  decodePaymentRequired,
  decodePaymentResponse,
} from '@blockpay402/core';
import { PaymentClient, type PaymentClientOptions } from './payment-client.js';

export interface PayingFetchOptions extends PaymentClientOptions {
  fetch?: typeof fetch;
}

export type PayingFetch = typeof fetch & { paymentClient: PaymentClient };

/**
 * A drop-in `fetch` that pays x402 endpoints on Sui. Non-402 responses pass through;
 * a 402 is paid (within caps) and the request is retried once with `PAYMENT-SIGNATURE`.
 * If the retry still fails, that response is returned for the caller to inspect.
 */
export function createPayingFetch(options: PayingFetchOptions | PaymentClient, fetchImpl?: typeof fetch): PayingFetch {
  const client = options instanceof PaymentClient ? options : new PaymentClient(options);
  const baseFetch =
    fetchImpl ?? (options instanceof PaymentClient ? undefined : options.fetch) ?? globalThis.fetch.bind(globalThis);

  const paying = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    // Keep a replayable copy: a body can only be read once.
    const retry = request.clone();
    const first = await baseFetch(request.clone());
    if (first.status !== 402) return first;

    const paymentRequired = await readPaymentRequired(first);
    if (!paymentRequired) return first;

    let response = await pay(retry, paymentRequired);
    if (response.retryable) {
      // The channel was closed or out of sync and has been replaced: pay once more.
      const required = await readPaymentRequired(response.response);
      if (required) response = await pay(request.clone(), required);
    }
    return response.response;
  };

  async function pay(request: Request, paymentRequired: PaymentRequired) {
    const replay = request.clone();
    const prepared = await client.prepare(request.url, paymentRequired);
    replay.headers.set(HEADERS.paymentSignature, prepared.header);
    let response: Response;
    try {
      response = await baseFetch(replay);
    } catch (error) {
      await prepared.complete(null, false);
      throw error;
    }
    const record = await prepared.complete(await settlementOf(response), response.ok);
    return { response, retryable: !!record.retryable };
  }
  return Object.assign(paying, { paymentClient: client }) as PayingFetch;
}

/** The settlement a paid response carries in `PAYMENT-RESPONSE`, if any. */
export function getPaymentResponse(response: Response): SettleResponse | null {
  const header = response.headers.get(HEADERS.paymentResponse);
  if (!header) return null;
  try {
    return decodePaymentResponse(header);
  } catch {
    return null;
  }
}

async function readPaymentRequired(response: Response): Promise<PaymentRequired | null> {
  const header = response.headers.get(HEADERS.paymentRequired);
  try {
    if (header) return PaymentRequiredSchema.parse(decodePaymentRequired(header)) as PaymentRequired;
    return PaymentRequiredSchema.parse(await response.clone().json()) as PaymentRequired;
  } catch {
    return null;
  }
}

async function settlementOf(response: Response): Promise<SettleResponse | null> {
  const settlement = getPaymentResponse(response);
  if (settlement) return settlement;
  if (response.status === 402) {
    // Rejected at verification: the reason is in the fresh PAYMENT-REQUIRED.
    const required = await readPaymentRequired(response);
    return { success: false, errorReason: required?.error ?? 'payment_rejected', transaction: '', network: 'sui:unknown' };
  }
  return null;
}
