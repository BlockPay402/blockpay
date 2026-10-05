/**
 * Next.js App Router integration. Route handlers use the Fetch API, so this is the
 * generic `withPayment` from `@blockpay402/server`; it also works with Hono, Bun,
 * Deno and Cloudflare Workers.
 *
 * ```ts
 * // app/api/weather/route.ts
 * export const GET = withPayment(
 *   { facilitator: { url: process.env.BLOCKPAY_FACILITATOR_URL! }, network: 'sui:testnet',
 *     payTo: process.env.BLOCKPAY_PAY_TO!, price: '$0.001', description: 'Current weather' },
 *   async (req, { payment }) => Response.json({ tempC: 31, payer: payment?.payer }),
 * );
 * ```
 */
export {
  withPayment,
  createPaymentHandler,
  type PaymentContext,
  type PaymentHandlerConfig,
  type SingleRouteConfig,
  type VerifiedPayment,
} from '@blockpay402/server';
