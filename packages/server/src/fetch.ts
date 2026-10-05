import {
  type PaymentHandler,
  type PaymentHandlerConfig,
  type RouteConfig,
  type VerifiedPayment,
  createPaymentHandler,
} from './handler.js';

export interface PaymentContext {
  /** Undefined only when a dynamic price returned `null` (free request). */
  payment?: VerifiedPayment;
}

/** One paid route: handler-level config for Next.js route handlers and similar. */
export type SingleRouteConfig = Omit<PaymentHandlerConfig, 'routes'> & RouteConfig;

type FetchHandler<Args extends unknown[]> = (request: Request, ...args: Args) => Response | Promise<Response>;
type PaidHandler<Args extends unknown[]> = (
  request: Request,
  context: PaymentContext,
  ...args: Args
) => Response | Promise<Response>;

/**
 * Wrap a Fetch-API handler (Next.js route handlers, Hono, Bun, Deno, Workers).
 * Unpaid requests get a 402; paid ones run the handler, then settle. A handler
 * response with status >= 400 is returned as-is and nothing is charged.
 */
export function withPayment<Args extends unknown[] = []>(
  config: PaymentHandlerConfig | SingleRouteConfig | PaymentHandler,
  handler: PaidHandler<Args>,
): FetchHandler<Args> {
  const payments = 'handle' in config ? config : createPaymentHandler(toHandlerConfig(config));
  return async (request, ...args) => {
    const url = new URL(request.url);
    const result = await payments.handle({
      method: request.method,
      path: url.pathname,
      url: request.url,
      header: (name) => request.headers.get(name) ?? undefined,
    });
    if (result.kind === 'free') return handler(request, {}, ...args);
    if (result.kind !== 'verified') {
      return new Response(JSON.stringify(result.body), { status: result.status, headers: result.headers });
    }
    if (result.mode === 'before-handler') {
      const settled = await result.settle();
      if (!settled.ok) return new Response(JSON.stringify(settled.body), { status: settled.status, headers: settled.headers });
      return withHeaders(await handler(request, { payment: result.payment }, ...args), settled.headers);
    }
    const response = await handler(request, { payment: result.payment }, ...args);
    if (response.status >= 400) return response;
    // Buffer so a failed settlement can still turn into a 402 instead of a free response.
    const body = await response.arrayBuffer();
    const settled = await result.settle();
    if (!settled.ok) return new Response(JSON.stringify(settled.body), { status: settled.status, headers: settled.headers });
    return withHeaders(new Response(body, response), settled.headers);
  };
}

function withHeaders(response: Response, headers: Record<string, string>): Response {
  const copy = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) copy.headers.set(name, value);
  copy.headers.append('access-control-expose-headers', Object.keys(headers).join(', '));
  return copy;
}

function toHandlerConfig(config: PaymentHandlerConfig | SingleRouteConfig): PaymentHandlerConfig {
  if ('routes' in config) return config;
  const { facilitator, network, payTo, settle, serviceName, logger, ...route } = config;
  return { facilitator, network, payTo, settle, serviceName, logger, routes: { '/**': route } };
}
