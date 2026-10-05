import { HEADERS, type PaymentRequired, PaymentRequiredSchema, decodePaymentRequired, decodePaymentResponse } from '@blockpay402/core';
import { PaymentClient, type PaymentClientOptions } from './payment-client.js';

/** The slice of an Axios instance the interceptor uses (avoids a hard axios dependency). */
interface AxiosLike {
  request(config: any): Promise<any>;
  interceptors: { response: { use(onFulfilled: (r: any) => any, onRejected: (e: any) => any): number } };
}

/** Pay x402 responses transparently on an Axios instance. */
export function attachPaymentInterceptor<T extends AxiosLike>(axios: T, options: PaymentClientOptions | PaymentClient): T {
  const client = options instanceof PaymentClient ? options : new PaymentClient(options);
  axios.interceptors.response.use(
    (response) => response,
    async (error) => {
      const response = error?.response;
      const config = error?.config;
      if (!response || response.status !== 402 || !config || config.__blockpayRetry) throw error;
      const paymentRequired = parse(response);
      if (!paymentRequired) throw error;
      const url = new URL(config.url ?? '', config.baseURL ?? 'http://localhost').toString();
      const prepared = await client.prepare(url, paymentRequired);
      try {
        const paid = await axios.request({
          ...config,
          __blockpayRetry: true,
          headers: { ...config.headers, [HEADERS.paymentSignature]: prepared.header },
        });
        const header = paid.headers?.[HEADERS.paymentResponse.toLowerCase()];
        await prepared.complete(header ? decodePaymentResponse(header) : null, true);
        return paid;
      } catch (retryError) {
        const header = (retryError as any)?.response?.headers?.[HEADERS.paymentResponse.toLowerCase()];
        await prepared.complete(header ? decodePaymentResponse(header) : null, false);
        throw retryError;
      }
    },
  );
  return axios;
}

function parse(response: { headers?: Record<string, string>; data?: unknown }): PaymentRequired | null {
  try {
    const header = response.headers?.[HEADERS.paymentRequired.toLowerCase()];
    return PaymentRequiredSchema.parse(header ? decodePaymentRequired(header) : response.data) as PaymentRequired;
  } catch {
    return null;
  }
}
