import { serve } from '@hono/node-server';
import { type Context, Hono } from 'hono';
import type { CallerContext, Facilitator } from './facilitator.js';

export interface HttpOptions {
  /**
   * Identify the caller (e.g. by API key). Return `null` for anonymous callers.
   * With `requireAuth`, anonymous calls to /verify and /settle get 401.
   */
  authenticate?(c: Context): Promise<CallerContext | null>;
  requireAuth?: boolean;
  /** Largest accepted request body. Payloads are a few KB. Default 64 KB. */
  maxBodyBytes?: number;
}

/** The x402 facilitator HTTP API: /supported, /verify, /settle, plus /health and /metrics. */
export function createFacilitatorApp(facilitator: Facilitator, options: HttpOptions = {}): Hono {
  const app = new Hono();
  const maxBody = options.maxBodyBytes ?? 64 * 1024;
  const counters = new Map<string, number>();
  const count = (name: string) => counters.set(name, (counters.get(name) ?? 0) + 1);

  async function caller(c: Context): Promise<CallerContext | null | Response> {
    const identity = options.authenticate ? await options.authenticate(c) : null;
    if (!identity && options.requireAuth) return c.json({ error: 'unauthorized' }, 401);
    return identity;
  }

  async function body(c: Context): Promise<unknown | Response> {
    const length = Number(c.req.header('content-length') ?? 0);
    if (length > maxBody) return c.json({ error: 'payload too large' }, 413);
    try {
      return await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
  }

  app.get('/supported', async (c) => c.json(await facilitator.supported()));

  app.post('/verify', async (c) => {
    const who = await caller(c);
    if (who instanceof Response) return who;
    const request = await body(c);
    if (request instanceof Response) return request;
    const result = await facilitator.verify(request as never, who ?? undefined);
    count(result.isValid ? 'verify_ok' : 'verify_invalid');
    return c.json(result);
  });

  app.post('/settle', async (c) => {
    const who = await caller(c);
    if (who instanceof Response) return who;
    const request = await body(c);
    if (request instanceof Response) return request;
    const result = await facilitator.settle(request as never, who ?? undefined);
    count(result.success ? 'settle_ok' : 'settle_failed');
    return c.json(result);
  });

  app.get('/health', async (c) => {
    const networks = await Promise.all(
      facilitator.networks.map(async (network) => {
        const ctx = facilitator.context(network)!;
        const balance = await ctx.client.core
          .getBalance({ owner: facilitator.address })
          .then((b) => b.balance.balance)
          .catch(() => null);
        return { network, gasBalance: balance };
      }),
    );
    return c.json({ ok: true, address: facilitator.address, networks });
  });

  app.get('/metrics', (c) => {
    const lines = ['# TYPE blockpay_facilitator_requests_total counter'];
    for (const [name, value] of counters) lines.push(`blockpay_facilitator_requests_total{result="${name}"} ${value}`);
    return c.text(`${lines.join('\n')}\n`, 200, { 'content-type': 'text/plain; version=0.0.4' });
  });

  return app;
}

/** Serve the facilitator over HTTP on Node. Put TLS and rate limiting in front of it. */
export function listen(facilitator: Facilitator, port: number, options: HttpOptions = {}) {
  const app = createFacilitatorApp(facilitator, options);
  return serve({ fetch: app.fetch, port });
}
