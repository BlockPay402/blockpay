import {
  type PaymentHandler,
  type PaymentHandlerConfig,
  type SettleOutcome,
  type VerifiedPayment,
  createPaymentHandler,
} from '@blockpay402/server';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set on paid routes once the payment is verified. */
      blockpay?: VerifiedPayment;
    }
  }
}

export type { PaymentHandlerConfig, VerifiedPayment } from '@blockpay402/server';

/**
 * Express middleware: answers unpaid requests on priced routes with 402, verifies
 * paid ones, runs your handler and settles before the response leaves. With the
 * default `after-handler` mode the response is buffered; a handler status >= 400
 * is sent unchanged and nothing is charged.
 */
export function paymentMiddleware(config: PaymentHandlerConfig | PaymentHandler): RequestHandler {
  const payments = 'handle' in config ? config : createPaymentHandler(config);
  return (req, res, next) => {
    run(payments, req, res, next).catch(next);
  };
}

async function run(payments: PaymentHandler, req: Request, res: Response, next: NextFunction) {
  const result = await payments.handle({
    method: req.method,
    path: req.baseUrl + req.path,
    url: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
    header: (name) => req.get(name) ?? undefined,
  });
  if (result.kind === 'free') return next();
  if (result.kind !== 'verified') {
    return res.status(result.status).set(result.headers).json(result.body);
  }
  req.blockpay = result.payment;
  if (result.mode === 'before-handler') {
    const settled = await result.settle();
    if (!settled.ok) return res.status(settled.status).set(settled.headers).json(settled.body);
    res.set(settled.headers);
    exposeHeaders(res, settled.headers);
    res.locals.blockpaySettlement = settled.response;
    return next();
  }
  bufferUntilSettled(res, result.settle);
  next();
}

/** Hold the response body until settlement decides between the handler's response and a 402. */
function bufferUntilSettled(res: Response, settle: () => Promise<SettleOutcome>) {
  const chunks: Buffer[] = [];
  type Loose = (...args: unknown[]) => unknown;
  const original = { write: res.write, end: res.end, writeHead: res.writeHead };
  const end = original.end as unknown as Loose;
  const writeHead = original.writeHead as unknown as Loose;
  let head: unknown[] | undefined;
  let finishing = false;

  const toBuffer = (chunk: unknown, encoding?: unknown): Buffer =>
    typeof chunk === 'string'
      ? Buffer.from(chunk, typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8')
      : Buffer.from(chunk as Uint8Array);

  res.writeHead = function (this: Response, ...args: unknown[]) {
    head = args;
    if (typeof args[0] === 'number') res.statusCode = args[0];
    return this;
  } as typeof res.writeHead;

  res.write = function (chunk: unknown, encoding?: unknown, callback?: unknown) {
    if (chunk != null) chunks.push(toBuffer(chunk, encoding));
    const cb = typeof encoding === 'function' ? encoding : callback;
    if (typeof cb === 'function') cb();
    return true;
  } as typeof res.write;

  res.end = function (this: Response, chunk?: unknown, encoding?: unknown, callback?: unknown) {
    if (finishing) return this;
    finishing = true;
    if (chunk != null && typeof chunk !== 'function') chunks.push(toBuffer(chunk, encoding));
    const cb = [chunk, encoding, callback].find((x) => typeof x === 'function') as (() => void) | undefined;
    const restore = () => Object.assign(res, original);
    const flush = () => {
      restore();
      if (head) writeHead.apply(res, head);
      end.call(res, Buffer.concat(chunks), cb);
    };
    if (res.statusCode >= 400) {
      flush();
      return this;
    }
    settle()
      .then((settled) => {
        if (settled.ok) {
          res.set(settled.headers);
          exposeHeaders(res, settled.headers);
          res.locals.blockpaySettlement = settled.response;
          return flush();
        }
        restore();
        head = undefined;
        res.removeHeader('content-length');
        res.status(settled.status).set(settled.headers);
        end.call(res, JSON.stringify(settled.body), cb);
      })
      .catch(() => {
        restore();
        res.removeHeader('content-length');
        res.status(500).set('content-type', 'application/json');
        end.call(res, JSON.stringify({ error: 'settlement failed' }), cb);
      });
    return this;
  } as typeof res.end;
}

function exposeHeaders(res: Response, headers: Record<string, string>) {
  const existing = res.get('access-control-expose-headers');
  const names = Object.keys(headers).join(', ');
  res.set('access-control-expose-headers', existing ? `${existing}, ${names}` : names);
}
