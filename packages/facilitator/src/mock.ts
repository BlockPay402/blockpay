import {
  type FacilitatorClient,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleRequest,
  type SettleResponse,
  type SupportedResponse,
  type VerifyRequest,
  type VerifyResponse,
  X402_VERSION,
  requirementsMatch,
} from '@blockpay402/core';
import { type ServerType, serve } from '@hono/node-server';
import { Hono } from 'hono';

export interface MockSettlement {
  requirements: PaymentRequirements;
  payload: PaymentPayload;
  transaction: string;
  amount: string;
  payer: string;
}

export interface MockFacilitatorOptions {
  /** Payer reported for every payment. */
  payer?: string;
  /** Return `isValid: false` with this reason for every verify. */
  rejectWith?: string;
  /** Fail every settle with this reason. */
  failSettleWith?: string;
}

/**
 * In-memory facilitator for tests: never touches Sui. Accepts any payload whose
 * `accepted` matches the requirements and records settlements.
 */
export class MockFacilitator implements FacilitatorClient {
  readonly settlements: MockSettlement[] = [];
  readonly verifications: VerifyRequest[] = [];
  url = '';
  private server: ServerType | undefined;
  private counter = 0;

  constructor(private readonly options: MockFacilitatorOptions = {}) {}

  async supported(): Promise<SupportedResponse> {
    const kinds = ['sui:mainnet', 'sui:testnet', 'sui:devnet', 'sui:localnet'].map((network) => ({
      x402Version: X402_VERSION,
      scheme: 'exact',
      network: network as `sui:${string}`,
    }));
    return { kinds, extensions: [], signers: {} };
  }

  async verify(request: VerifyRequest): Promise<VerifyResponse> {
    this.verifications.push(request);
    const payer = this.options.payer ?? '0x' + '1'.repeat(64);
    if (this.options.rejectWith) return { isValid: false, invalidReason: this.options.rejectWith, payer };
    if (!requirementsMatch(request.paymentPayload.accepted, request.paymentRequirements)) {
      return { isValid: false, invalidReason: 'payment_requirements_mismatch' };
    }
    return { isValid: true, payer };
  }

  async settle(request: SettleRequest): Promise<SettleResponse> {
    const network = request.paymentRequirements.network;
    const verified = await this.verify(request);
    if (!verified.isValid) return { success: false, errorReason: verified.invalidReason, transaction: '', network };
    if (this.options.failSettleWith) {
      return { success: false, errorReason: this.options.failSettleWith, transaction: '', network };
    }
    const transaction = `mock-${(++this.counter).toString().padStart(8, '0')}`;
    const payer = verified.payer!;
    this.settlements.push({
      requirements: request.paymentRequirements,
      payload: request.paymentPayload,
      transaction,
      amount: request.paymentRequirements.amount,
      payer,
    });
    return { success: true, transaction, network, payer, amount: request.paymentRequirements.amount };
  }

  /** Serve the facilitator API on a random local port; sets `url`. */
  async listen(): Promise<string> {
    const app = new Hono();
    app.get('/supported', async (c) => c.json(await this.supported()));
    app.post('/verify', async (c) => c.json(await this.verify(await c.req.json())));
    app.post('/settle', async (c) => c.json(await this.settle(await c.req.json())));
    await new Promise<void>((resolve) => {
      this.server = serve({ fetch: app.fetch, port: 0 }, (info) => {
        this.url = `http://127.0.0.1:${info.port}`;
        resolve();
      });
    });
    return this.url;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}

export function createMockFacilitator(options?: MockFacilitatorOptions): MockFacilitator {
  return new MockFacilitator(options);
}
