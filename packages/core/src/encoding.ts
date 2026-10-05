import type { PaymentPayload, PaymentRequired, SettleResponse } from './types.js';

/** HTTP transport headers (x402 v2). */
export const HEADERS = {
  paymentRequired: 'PAYMENT-REQUIRED',
  paymentSignature: 'PAYMENT-SIGNATURE',
  paymentResponse: 'PAYMENT-RESPONSE',
} as const;

/** Base64 (standard alphabet) of UTF-8 JSON. Works in Node, browsers and edge runtimes. */
export function encodeBase64Json(value: unknown): string {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(value)));
}

export function decodeBase64Json<T = unknown>(value: string): T {
  return JSON.parse(new TextDecoder().decode(base64ToBytes(value))) as T;
}

export const encodePaymentRequired = (value: PaymentRequired) => encodeBase64Json(value);
export const decodePaymentRequired = (value: string) => decodeBase64Json<PaymentRequired>(value);
export const encodePaymentPayload = (value: PaymentPayload) => encodeBase64Json(value);
export const decodePaymentPayload = (value: string) => decodeBase64Json<PaymentPayload>(value);
export const encodePaymentResponse = (value: SettleResponse) => encodeBase64Json(value);
export const decodePaymentResponse = (value: string) => decodeBase64Json<SettleResponse>(value);

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  // Accept base64url too: some clients send it.
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
