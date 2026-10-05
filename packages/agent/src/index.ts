import {
  PaymentCapExceededError,
  type Price,
  type SuiNetwork,
  normalizeCoinType,
  resolvePrice,
  toSuiNetwork,
} from '@blockpay402/core';
import {
  type PayingFetch,
  PaymentClient,
  type PaymentClientOptions,
  type PaymentRecord,
  type PaymentRequest,
  createPayingFetch,
  getPaymentResponse,
} from '@blockpay402/client';

export interface AgentBudgets {
  /** Hard cap per call. */
  perRequest: Price;
  /** Hard cap per rolling 24h, across hosts. */
  perDay?: Price;
  /** Hard cap per rolling 24h for specific hosts. */
  perHost?: Record<string, Price>;
  /** Hard cap for the lifetime of this wallet instance (e.g. one task). */
  total?: Price;
}

export interface ApprovalRequest {
  url: string;
  host: string;
  amount: string;
  asset: string;
  payTo: string;
  scheme: string;
  description?: string;
}

export interface AgentWalletOptions
  extends Omit<PaymentClientOptions, 'maxPerRequest' | 'dailyCap' | 'onPaymentRequired' | 'onPayment'> {
  network: SuiNetwork | string;
  budgets: AgentBudgets;
  /** Payments above this go through `approve`. Below it they are automatic. */
  softThreshold?: Price;
  /** Human-in-the-loop hook. Return true to pay. Without it, payments above the threshold are declined. */
  approve?(request: ApprovalRequest): Promise<boolean> | boolean;
  /** Audit trail: called after every payment attempt. */
  onSettled?(record: PaymentRecord): void | Promise<void>;
  fetch?: typeof fetch;
}

export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema for the tool input, usable with Claude tool use, MCP or any function-calling API. */
  inputSchema: Record<string, unknown>;
  execute(input: { url: string; method?: string; body?: string; headers?: Record<string, string> }): Promise<{
    status: number;
    body: string;
    paid?: { amount: string; asset: string; transaction?: string };
  }>;
}

/**
 * A wallet for autonomous agents. Budgets are enforced in code before anything is signed,
 * so the model's reasoning cannot raise them. For an on-chain ceiling as well, fund the
 * agent's address with only what it may spend, or prefer `batch-settlement` channels,
 * whose voucher key can never pay more than the channel deposit.
 */
export class AgentWallet {
  readonly network: SuiNetwork;
  readonly client: PaymentClient;
  readonly fetch: PayingFetch;
  readonly records: PaymentRecord[] = [];
  private readonly hostSpend = new Map<string, Array<{ at: number; amount: bigint }>>();
  private totalSpent = 0n;

  constructor(private readonly options: AgentWalletOptions) {
    this.network = toSuiNetwork(options.network);
    this.client = new PaymentClient({
      ...options,
      network: this.network,
      maxPerRequest: options.budgets.perRequest,
      dailyCap: options.budgets.perDay,
      onPaymentRequired: (request) => this.authorize(request),
      onPayment: async (record) => {
        this.records.push(record);
        if (record.success) this.track(record);
        await options.onSettled?.(record);
      },
    });
    this.fetch = createPayingFetch(this.client, options.fetch);
  }

  /** Spent in the asset of `perRequest` during this wallet's lifetime, atomic units. */
  get spent(): bigint {
    return this.totalSpent;
  }

  /** Expose paid HTTP as one tool. The description states the budget so the model can plan. */
  asTool(options: { name?: string; description?: string } = {}): AgentTool {
    const perRequest = resolvePrice(this.network, this.options.budgets.perRequest);
    const budgetNote = `Pays automatically up to ${perRequest.amount} atomic units of ${perRequest.asset.symbol} per call` +
      (this.options.budgets.perDay ? `, ${resolvePrice(this.network, this.options.budgets.perDay).amount} per day` : '') +
      '. Calls above budget fail without paying.';
    return {
      name: options.name ?? 'pay_and_fetch',
      description:
        options.description ??
        `Fetch a URL. If it requires an x402 payment on Sui, pay it from the agent wallet. ${budgetNote}`,
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Absolute URL to fetch' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'GET' },
          body: { type: 'string', description: 'Request body (JSON string), for POST/PUT/PATCH' },
          headers: { type: 'object', additionalProperties: { type: 'string' } },
        },
        required: ['url'],
      },
      execute: async ({ url, method = 'GET', body, headers }) => {
        try {
          const response = await this.fetch(url, { method, body, headers });
          const settlement = getPaymentResponse(response);
          const last = this.records.at(-1);
          return {
            status: response.status,
            body: (await response.text()).slice(0, 100_000),
            ...(settlement?.success && last
              ? { paid: { amount: last.amount, asset: last.asset, transaction: settlement.transaction } }
              : {}),
          };
        } catch (error) {
          return { status: 0, body: `Payment not made: ${(error as Error).message}` };
        }
      },
    };
  }

  private async authorize(request: PaymentRequest): Promise<boolean> {
    const { requirements, url } = request;
    const host = new URL(url).host;
    const asset = normalizeCoinType(requirements.asset);
    const amount = BigInt(requirements.amount);

    const hostCap = this.options.budgets.perHost?.[host];
    if (hostCap) {
      const cap = resolvePrice(this.network, hostCap);
      const spent = this.spentOnHost(host, Date.now() - 86_400_000);
      if (cap.asset.coinType !== asset || spent + amount > BigInt(cap.amount)) {
        throw new PaymentCapExceededError(`Payment would exceed the budget for ${host}`, {
          amount: requirements.amount,
          asset,
          cap: cap.amount,
          scope: `host:${host}`,
        });
      }
    }
    if (this.options.budgets.total) {
      const cap = resolvePrice(this.network, this.options.budgets.total);
      if (cap.asset.coinType !== asset || this.totalSpent + amount > BigInt(cap.amount)) {
        throw new PaymentCapExceededError('Payment would exceed the total budget', {
          amount: requirements.amount,
          asset,
          cap: cap.amount,
          scope: 'total',
        });
      }
    }
    const threshold = this.options.softThreshold ? resolvePrice(this.network, this.options.softThreshold) : undefined;
    if (!threshold || (threshold.asset.coinType === asset && amount <= BigInt(threshold.amount))) return true;
    if (!this.options.approve) return false;
    return this.options.approve({
      url,
      host,
      amount: requirements.amount,
      asset,
      payTo: requirements.payTo,
      scheme: requirements.scheme,
      description: request.paymentRequired.resource.description,
    });
  }

  private track(record: PaymentRecord) {
    const host = new URL(record.url).host;
    const list = this.hostSpend.get(host) ?? [];
    list.push({ at: record.at, amount: BigInt(record.amount) });
    this.hostSpend.set(host, list);
    this.totalSpent += BigInt(record.amount);
  }

  private spentOnHost(host: string, since: number): bigint {
    return (this.hostSpend.get(host) ?? []).filter((e) => e.at >= since).reduce((s, e) => s + e.amount, 0n);
  }
}

export function createAgentWallet(options: AgentWalletOptions): AgentWallet {
  return new AgentWallet(options);
}

export type { PaymentRecord } from '@blockpay402/client';
