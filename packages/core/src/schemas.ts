import { z } from 'zod';
import { X402_VERSION } from './types.js';

const atomic = z.string().regex(/^\d+$/, 'must be an unsigned integer string');
const base64 = z.string().min(1).regex(/^[A-Za-z0-9+/_-]+={0,2}$/, 'must be base64');
const suiAddress = z.string().regex(/^0x[0-9a-fA-F]{1,64}$/, 'must be a Sui address');

export const ResourceInfoSchema = z.object({
  url: z.string().min(1),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  serviceName: z.string().max(32).optional(),
  tags: z.array(z.string().max(32)).max(5).optional(),
  iconUrl: z.string().max(2048).optional(),
});

export const PaymentRequirementsSchema = z.object({
  scheme: z.string().min(1),
  network: z.string().regex(/^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/, 'must be a CAIP-2 network id'),
  amount: atomic,
  asset: z.string().min(1),
  payTo: z.string().min(1),
  maxTimeoutSeconds: z.number().int().positive(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const PaymentRequiredSchema = z.object({
  x402Version: z.literal(X402_VERSION),
  error: z.string().optional(),
  resource: ResourceInfoSchema,
  accepts: z.array(PaymentRequirementsSchema),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

export const PaymentPayloadSchema = z.object({
  x402Version: z.literal(X402_VERSION),
  resource: ResourceInfoSchema.optional(),
  accepted: PaymentRequirementsSchema,
  payload: z.unknown(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

export const VerifyRequestSchema = z.object({
  x402Version: z.literal(X402_VERSION),
  paymentPayload: PaymentPayloadSchema,
  paymentRequirements: PaymentRequirementsSchema,
});

export const ExactSuiPayloadSchema = z.object({
  transaction: base64,
  signature: base64,
});

const voucherFields = {
  channelId: suiAddress,
  cumulativeAmount: atomic,
  signature: base64,
};

export const BatchSettlementSuiPayloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('voucher'), ...voucherFields }),
  z.object({
    type: z.enum(['open', 'topUp']),
    transaction: base64,
    transactionSignature: base64,
    ...voucherFields,
  }),
]);

export const BatchSettlementSuiExtraSchema = z.object({
  operator: suiAddress,
  channelPackage: suiAddress,
  channelRegistry: suiAddress,
  withdrawDelayMs: z.number().int().positive(),
  minDeposit: atomic.optional(),
  feePayer: suiAddress.optional(),
});
