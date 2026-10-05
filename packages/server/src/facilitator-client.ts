import type {
  FacilitatorClient,
  SettleRequest,
  SettleResponse,
  SupportedResponse,
  VerifyRequest,
  VerifyResponse,
} from '@blockpay402/core';

export interface HttpFacilitatorOptions {
  url: string;
  /** Sent as `Authorization: Bearer <apiKey>` (hosted facilitators). */
  apiKey?: string;
  headers?: Record<string, string>;
  /** Per-request timeout. Settlement waits for finality, so keep it generous. Default 30s. */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** Talks to any x402 v2 facilitator over HTTP. */
export class HttpFacilitatorClient implements FacilitatorClient {
  private readonly url: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: HttpFacilitatorOptions) {
    this.url = options.url.replace(/\/+$/, '');
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  verify(request: VerifyRequest): Promise<VerifyResponse> {
    return this.call('/verify', request);
  }

  settle(request: SettleRequest): Promise<SettleResponse> {
    return this.call('/settle', request);
  }

  supported(): Promise<SupportedResponse> {
    return this.call('/supported');
  }

  private async call<T>(path: string, body?: unknown): Promise<T> {
    const response = await this.fetchFn(`${this.url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
        ...this.options.headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Facilitator ${path} returned ${response.status}: ${text.slice(0, 200)}`);
    }
    return (await response.json()) as T;
  }
}
