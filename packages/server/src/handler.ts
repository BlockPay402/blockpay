import {
  ErrorReason,
  type FacilitatorClient,
  GASLESS_MIN_UNITS,
  HEADERS,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  PaymentPayloadSchema,
  type Price,
  type SettleResponse,
  type SuiNetwork,
  type SupportedResponse,
  X402_VERSION,
  decodePaymentPayload,
  encodePaymentRequired,
  encodePaymentResponse,
  findMatchingRequirements,
  normalizeAddress,
  resolvePrice,
  toAtomic,
  toSuiNetwork,
} from '@blockpay402/core';
import { HttpFacilitatorClient, type HttpFacilitatorOptions } from './facilitator-client.js';
import { type CompiledRoute, compileRoutes, matchRoute } from './routes.js';

export type SettleMode = 'after-handler' | 'before-handler';
export type PaymentScheme = 'exact' | 'batch-settlement';

/** What the handler needs to know about an incoming request. */
export interface RequestInfo {
  method: string;
  /** Path without query string, e.g. `/weather`. */
  path: string;
  /** Absolute URL, used as the x402 `resource.url`. */
  url: string;
  header(name: string): string | undefined;
}

export interface PricedRequest extends RequestInfo {
  params: Record<string, string>;
  query: URLSearchParams;
}

type Dynamic<T> = T | ((req: PricedRequest) => T | Promise<T>);

export interface RouteConfig {
  /** `"$0.001"`, `0.001` (USD) or `{ amount, asset }`. Return `null` from a function to make this request free. */
  price: Dynamic<Price | null>;
  description?: Dynamic<string>;
  mimeType?: string;
  /** Default 60. */
  maxTimeoutSeconds?: number;
  /** Schemes to offer, in preference order. Default: all the facilitator supports. */
  schemes?: PaymentScheme[];
  /** Override the default receiving address for this route. */
  payTo?: string;
  settle?: SettleMode;
  /** Suggested channel deposit for `batch-settlement`, atomic units. Default 100 × price. */
  minDeposit?: string;
}

export interface PaymentHandlerConfig {
  /** A facilitator instance, or how to reach one over HTTP. */
  facilitator: FacilitatorClient | HttpFacilitatorOptions;
  network: SuiNetwork | string;
  /** Address that receives payments. */
  payTo: string;
  /** `"GET /weather": { price: "$0.001" }`, or just `"GET /weather": "$0.001"`. */
  routes: Record<string, RouteConfig | Price>;
  /** Default `after-handler`: run the handler, then settle; nothing is charged if it fails. */
  settle?: SettleMode;
  serviceName?: string;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface VerifiedPayment {
  payer: string;
  requirements: PaymentRequirements;
  payload: PaymentPayload;
  amount: string;
  asset: string;
  scheme: string;
  network: string;
}

export interface HttpResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export type SettleOutcome =
  | { ok: true; response: SettleResponse; headers: Record<string, string> }
  | ({ ok: false; response: SettleResponse } & HttpResult);

export type HandleResult =
  | { kind: 'free' }
  | ({ kind: 'payment-required' } & HttpResult)
  | ({ kind: 'invalid' } & HttpResult)
  | {
      kind: 'verified';
      mode: SettleMode;
      payment: VerifiedPayment;
      settle(): Promise<SettleOutcome>;
    };

const SUPPORTED_TTL_MS = 5 * 60_000;

export class PaymentHandler {
  readonly network: SuiNetwork;
  private readonly facilitator: FacilitatorClient;
  private readonly routes: CompiledRoute<RouteConfig>[];
  private supportedCache: { at: number; value: Promise<SupportedResponse> } | undefined;

  constructor(private readonly config: PaymentHandlerConfig) {
    this.network = toSuiNetwork(config.network);
    this.facilitator = 'verify' in config.facilitator ? config.facilitator : new HttpFacilitatorClient(config.facilitator);
    normalizeAddress(config.payTo); // fail fast on a bad address
    this.routes = compileRoutes(
      Object.fromEntries(
        Object.entries(config.routes).map(([key, value]) => [key, isRouteConfig(value) ? value : { price: value }]),
      ),
    );
  }

  /** Decide what to do with a request. Adapters turn the result into a response. */
  async handle(req: RequestInfo): Promise<HandleResult> {
    const match = matchRoute(this.routes, req.method, req.path);
    if (!match) return { kind: 'free' };
    const priced: PricedRequest = { ...req, params: match.params, query: new URL(req.url).searchParams };
    const route = match.route.config;
    const price = await resolveDynamic(route.price, priced);
    if (price === null) return { kind: 'free' };

    const paymentRequired = await this.buildPaymentRequired(route, priced, price);
    const header = req.header(HEADERS.paymentSignature) ?? req.header('X-PAYMENT');
    if (!header) return this.paymentRequired(paymentRequired, `${HEADERS.paymentSignature} header is required`);

    let payload: PaymentPayload;
    try {
      payload = PaymentPayloadSchema.parse(decodePaymentPayload(header)) as PaymentPayload;
    } catch {
      return { kind: 'invalid', ...this.result(400, paymentRequired, ErrorReason.invalidPayload) };
    }
    const requirements = findMatchingRequirements(paymentRequired.accepts, payload.accepted);
    if (!requirements) return this.paymentRequired(paymentRequired, ErrorReason.requirementsMismatch);

    const request = { x402Version: X402_VERSION, paymentPayload: payload, paymentRequirements: requirements };
    const verification = await this.facilitator.verify(request);
    if (!verification.isValid) {
      return this.paymentRequired(paymentRequired, verification.invalidReason ?? 'payment_invalid');
    }

    const payment: VerifiedPayment = {
      payer: verification.payer ?? '',
      requirements,
      payload,
      amount: requirements.amount,
      asset: requirements.asset,
      scheme: requirements.scheme,
      network: requirements.network,
    };
    return {
      kind: 'verified',
      mode: route.settle ?? this.config.settle ?? 'after-handler',
      payment,
      settle: async () => {
        let response: SettleResponse;
        try {
          response = await this.facilitator.settle(request);
        } catch (error) {
          this.config.logger?.error('blockpay settle failed', error);
          response = { success: false, errorReason: ErrorReason.unexpectedSettleError, transaction: '', network: requirements.network };
        }
        const headers = { [HEADERS.paymentResponse]: encodePaymentResponse(response) };
        if (response.success) return { ok: true, response, headers };
        const failed = this.result(402, paymentRequired, response.errorReason ?? 'settlement_failed');
        return { ok: false, response, ...failed, headers: { ...failed.headers, ...headers } };
      },
    };
  }

  /** The 402 body for a route, e.g. to publish prices for discovery. */
  async buildPaymentRequired(route: RouteConfig, req: PricedRequest, price: Price): Promise<PaymentRequired> {
    const { amount, asset } = resolvePrice(this.network, price);
    const supported = await this.supported();
    const kinds = supported.kinds.filter((k) => k.network === this.network);
    const gasless = !!asset.gasless && BigInt(amount) >= BigInt(toAtomic(GASLESS_MIN_UNITS, asset.decimals));
    const offered = route.schemes ?? (gasless ? ['exact', 'batch-settlement'] : ['batch-settlement', 'exact']);
    const payTo = normalizeAddress(route.payTo ?? this.config.payTo);
    const accepts: PaymentRequirements[] = [];
    for (const scheme of offered) {
      const kind = kinds.find((k) => k.scheme === scheme);
      if (!kind) continue;
      const extra: Record<string, unknown> = { ...kind.extra };
      if (scheme === 'exact' && gasless) extra.gasless = true;
      if (scheme === 'batch-settlement') extra.minDeposit = route.minDeposit ?? (BigInt(amount) * 100n).toString();
      accepts.push({
        scheme,
        network: this.network,
        amount,
        asset: asset.coinType,
        payTo,
        maxTimeoutSeconds: route.maxTimeoutSeconds ?? 60,
        ...(Object.keys(extra).length ? { extra } : {}),
      });
    }
    if (accepts.length === 0) {
      throw new Error(`Facilitator supports none of [${offered.join(', ')}] on ${this.network}`);
    }
    const description = route.description ? await resolveDynamic(route.description, req) : undefined;
    return {
      x402Version: X402_VERSION,
      resource: {
        url: req.url,
        ...(description ? { description } : {}),
        ...(route.mimeType ? { mimeType: route.mimeType } : {}),
        ...(this.config.serviceName ? { serviceName: this.config.serviceName } : {}),
      },
      accepts,
    };
  }

  private supported(): Promise<SupportedResponse> {
    const now = Date.now();
    if (!this.supportedCache || now - this.supportedCache.at > SUPPORTED_TTL_MS) {
      const value = this.facilitator.supported();
      value.catch(() => (this.supportedCache = undefined));
      this.supportedCache = { at: now, value };
    }
    return this.supportedCache.value;
  }

  private paymentRequired(body: PaymentRequired, error: string): HandleResult {
    return { kind: 'payment-required', ...this.result(402, body, error) };
  }

  private result(status: number, body: PaymentRequired, error: string): HttpResult {
    const withError = { ...body, error };
    return {
      status,
      headers: { [HEADERS.paymentRequired]: encodePaymentRequired(withError), 'content-type': 'application/json' },
      body: withError,
    };
  }
}

export function createPaymentHandler(config: PaymentHandlerConfig): PaymentHandler {
  return new PaymentHandler(config);
}

function isRouteConfig(value: RouteConfig | Price): value is RouteConfig {
  return typeof value === 'object' && value !== null && 'price' in value;
}

async function resolveDynamic<T>(value: Dynamic<T>, req: PricedRequest): Promise<T> {
  return typeof value === 'function' ? (value as (r: PricedRequest) => T | Promise<T>)(req) : value;
}
