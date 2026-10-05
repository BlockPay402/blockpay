import {
  type BatchSettlementSuiExtra,
  BatchSettlementSuiExtraSchema,
  type BatchSettlementSuiPayload,
  type ChannelDeployment,
  ErrorReason,
  NoSupportedRequirementError,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  PaymentCapExceededError,
  PaymentDeclinedError,
  type Price,
  type SettleResponse,
  type SuiNetwork,
  X402_VERSION,
  bytesToBase64,
  encodePaymentPayload,
  isSuiNetwork,
  normalizeAddress,
  normalizeCoinType,
  resolveNetwork,
  resolvePrice,
  toSuiNetwork,
} from '@blockpay402/core';
import {
  type GasMode,
  type SuiClient,
  buildOpenChannelTransaction,
  buildTopUpTransaction,
  createExactPayment,
  createSuiClient,
  deriveChannelId,
  getChannel,
  loadKeypair,
  randomNonce,
  resolveSigner,
  signVoucher,
} from '@blockpay402/sui';
import type { Signer } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { Transaction } from '@mysten/sui/transactions';
import { type ChannelEntry, type ChannelStore, KeyedMutex, MemoryChannelStore } from './channels.js';
import { SpendTracker } from './spend.js';

export type PaymentScheme = 'exact' | 'batch-settlement';

export interface NetworkClientOptions {
  grpcUrl?: string;
  client?: SuiClient;
  /** `blockpay::channel` deployment. Required for `batch-settlement` until a canonical one is published. */
  channel?: ChannelDeployment;
}

export interface PaymentRequest {
  url: string;
  paymentRequired: PaymentRequired;
  requirements: PaymentRequirements;
}

export interface PaymentRecord {
  url: string;
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  payer: string;
  success: boolean;
  /** Transaction digest (`exact`) or commitment id (`batch-settlement`). */
  transaction?: string;
  errorReason?: string;
  /** The channel was unusable and has been replaced: repeating the request opens a new one. */
  retryable?: boolean;
  at: number;
}

export interface PaymentClientOptions {
  signer?: Signer;
  privateKey?: string;
  /** Only pay on these networks. Default: every network configured in `networks`, else all Sui networks. */
  network?: SuiNetwork | string;
  networks?: Partial<Record<SuiNetwork, NetworkClientOptions>>;
  /** Refuse any single payment above this. Default `$0.10`. Payments in other assets are refused. */
  maxPerRequest?: Price;
  /** Refuse payments once this much was spent in the last 24h. */
  dailyCap?: Price;
  /** Schemes this client may use, most preferred first. Default: follow the server's order. */
  schemes?: PaymentScheme[];
  /** Gas for `exact`: `auto` uses gasless, then the server's sponsor, then the payer's own SUI. */
  gas?: GasMode;
  channels?: {
    /** Deposit for a new channel. Default: the server's `minDeposit`, else 100 × price. */
    deposit?: Price;
    /** Never lock more than this in one channel. Default `$5`. */
    maxDeposit?: Price;
    store?: ChannelStore;
  };
  /** Called before signing. Return false to decline (throws `PaymentDeclinedError`). */
  onPaymentRequired?(request: PaymentRequest): boolean | void | Promise<boolean | void>;
  /** Called after the paid response arrives. */
  onPayment?(record: PaymentRecord): void | Promise<void>;
}

export interface PreparedPayment {
  header: string;
  requirements: PaymentRequirements;
  /** Report the outcome; releases the channel lock. */
  complete(settlement: SettleResponse | null, ok: boolean): Promise<PaymentRecord>;
}

/** Turns a 402 into a signed `PAYMENT-SIGNATURE` header, within caps. Transport-agnostic. */
export class PaymentClient {
  readonly signer: Signer;
  readonly address: string;
  private readonly clients = new Map<SuiNetwork, SuiClient>();
  private readonly allowedNetworks: Set<SuiNetwork> | undefined;
  private readonly channels: ChannelStore;
  private readonly locks = new KeyedMutex();
  /** Our last on-chain payment per network. Its effects must be indexed before we build on them. */
  private readonly lastTransaction = new Map<SuiNetwork, string>();
  readonly spend = new SpendTracker();

  constructor(private readonly options: PaymentClientOptions) {
    this.signer = resolveSigner(options);
    this.address = normalizeAddress(this.signer.toSuiAddress());
    this.channels = options.channels?.store ?? new MemoryChannelStore();
    if (options.network) this.allowedNetworks = new Set([toSuiNetwork(options.network)]);
    else if (options.networks) this.allowedNetworks = new Set(Object.keys(options.networks) as SuiNetwork[]);
  }

  /** Pick a payable requirement and sign it. Throws if none is acceptable. */
  async prepare(url: string, paymentRequired: PaymentRequired): Promise<PreparedPayment> {
    const candidates = this.rank(paymentRequired.accepts);
    if (candidates.length === 0) {
      throw new NoSupportedRequirementError(`No payment option for ${url} is payable by this client`);
    }
    let capError: PaymentCapExceededError | undefined;
    for (const requirements of candidates) {
      const network = requirements.network as SuiNetwork;
      try {
        this.checkCaps(network, requirements);
      } catch (error) {
        if (error instanceof PaymentCapExceededError) {
          capError = error;
          continue;
        }
        throw error;
      }
      const approved = await this.options.onPaymentRequired?.({ url, paymentRequired, requirements });
      if (approved === false) throw new PaymentDeclinedError(`Payment for ${url} was declined`);
      return requirements.scheme === 'batch-settlement'
        ? this.prepareChannelPayment(url, paymentRequired, requirements)
        : this.prepareExactPayment(url, paymentRequired, requirements);
    }
    throw capError ?? new NoSupportedRequirementError(`No payment option for ${url} is payable by this client`);
  }

  client(network: SuiNetwork): SuiClient {
    let client = this.clients.get(network);
    if (!client) {
      const options = this.options.networks?.[network];
      client = options?.client ?? createSuiClient(resolveNetwork(network, { grpcUrl: options?.grpcUrl }));
      this.clients.set(network, client);
    }
    return client;
  }

  listChannels(): Promise<ChannelEntry[]> {
    return this.channels.list();
  }

  // --- selection ------------------------------------------------------------

  private rank(accepts: PaymentRequirements[]): PaymentRequirements[] {
    const usable = accepts.filter((r) => {
      if (!isSuiNetwork(r.network)) return false;
      if (this.allowedNetworks && !this.allowedNetworks.has(r.network)) return false;
      if (r.scheme === 'exact') return true;
      if (r.scheme === 'batch-settlement') return this.channelDeploymentFor(r) !== undefined;
      return false;
    });
    const preference = this.options.schemes;
    if (!preference) return usable;
    return usable
      .filter((r) => preference.includes(r.scheme as PaymentScheme))
      .sort((a, b) => preference.indexOf(a.scheme as PaymentScheme) - preference.indexOf(b.scheme as PaymentScheme));
  }

  /** The channel deployment the client trusts for this network, if it matches the server's. */
  private channelDeploymentFor(requirements: PaymentRequirements): ChannelDeployment | undefined {
    const parsed = BatchSettlementSuiExtraSchema.safeParse(requirements.extra ?? {});
    if (!parsed.success) return undefined;
    const network = requirements.network as SuiNetwork;
    const trusted = this.options.networks?.[network]?.channel ?? resolveNetwork(network).channel;
    if (!trusted) return undefined;
    const same =
      normalizeAddress(trusted.packageId) === normalizeAddress(parsed.data.channelPackage) &&
      normalizeAddress(trusted.registryId) === normalizeAddress(parsed.data.channelRegistry);
    return same ? trusted : undefined;
  }

  private checkCaps(network: SuiNetwork, requirements: PaymentRequirements) {
    const asset = normalizeCoinType(requirements.asset);
    const amount = BigInt(requirements.amount);
    const perRequest = resolvePrice(network, this.options.maxPerRequest ?? '$0.10');
    if (perRequest.asset.coinType !== asset) {
      throw new PaymentCapExceededError(`No per-request cap configured for ${asset}`, {
        amount: requirements.amount,
        asset,
        cap: '0',
        scope: 'asset',
      });
    }
    if (amount > BigInt(perRequest.amount)) {
      throw new PaymentCapExceededError(`Payment of ${amount} exceeds the per-request cap ${perRequest.amount}`, {
        amount: requirements.amount,
        asset,
        cap: perRequest.amount,
        scope: 'request',
      });
    }
    if (this.options.dailyCap) {
      const daily = resolvePrice(network, this.options.dailyCap);
      const spent = this.spend.spentSince(asset, Date.now() - 86_400_000);
      if (daily.asset.coinType === asset && spent + amount > BigInt(daily.amount)) {
        throw new PaymentCapExceededError(`Payment would exceed the daily cap ${daily.amount}`, {
          amount: requirements.amount,
          asset,
          cap: daily.amount,
          scope: 'day',
        });
      }
    }
  }

  // --- exact -----------------------------------------------------------------

  private async prepareExactPayment(
    url: string,
    paymentRequired: PaymentRequired,
    requirements: PaymentRequirements,
  ): Promise<PreparedPayment> {
    await this.settled(requirements.network as SuiNetwork);
    const payload = await createExactPayment({
      client: this.client(requirements.network as SuiNetwork),
      signer: this.signer,
      requirements,
      gas: this.options.gas,
    });
    return {
      header: this.encode(paymentRequired, requirements, payload),
      requirements,
      complete: (settlement, ok) => this.record(url, requirements, settlement, ok),
    };
  }

  // --- batch-settlement --------------------------------------------------------

  private async prepareChannelPayment(
    url: string,
    paymentRequired: PaymentRequired,
    requirements: PaymentRequirements,
  ): Promise<PreparedPayment> {
    const network = requirements.network as SuiNetwork;
    const deployment = this.channelDeploymentFor(requirements)!;
    const extra = BatchSettlementSuiExtraSchema.parse(requirements.extra) as BatchSettlementSuiExtra;
    const key = [network, normalizeAddress(requirements.payTo), normalizeCoinType(requirements.asset), normalizeAddress(extra.operator)].join('|');
    const release = await this.locks.acquire(key);
    try {
      const amount = BigInt(requirements.amount);
      const existing = await this.channels.get(key);
      let entry: ChannelEntry;
      let payload: BatchSettlementSuiPayload;

      if (!existing) {
        const nonce = randomNonce();
        const authorizer = Ed25519Keypair.generate();
        const deposit = this.depositFor(network, requirements, extra, amount);
        const channelId = deriveChannelId(deployment, this.address, nonce);
        const tx = buildOpenChannelTransaction({
          deployment,
          sender: this.address,
          coinType: requirements.asset,
          payee: requirements.payTo,
          operator: extra.operator,
          authorizer: authorizer.getPublicKey().toRawBytes(),
          withdrawDelayMs: extra.withdrawDelayMs,
          nonce,
          deposit,
          feePayer: this.options.gas === 'self' ? undefined : extra.feePayer,
        });
        const signed = await this.signTransaction(network, tx);
        entry = {
          key,
          network,
          channelId,
          nonce: nonce.toString(),
          payTo: normalizeAddress(requirements.payTo),
          asset: normalizeCoinType(requirements.asset),
          operator: normalizeAddress(extra.operator),
          authorizerSecret: authorizer.getSecretKey(),
          deposit: deposit.toString(),
          cumulative: '0',
          createdAt: Date.now(),
        };
        payload = {
          type: 'open',
          ...signed,
          channelId,
          cumulativeAmount: amount.toString(),
          signature: await signVoucher(authorizer, channelId, amount),
        };
      } else {
        entry = existing;
        const authorizer = loadKeypair(entry.authorizerSecret) as Ed25519Keypair;
        const cumulative = BigInt(entry.cumulative) + amount;
        const signature = await signVoucher(authorizer, entry.channelId, cumulative);
        if (cumulative <= BigInt(entry.deposit)) {
          payload = { type: 'voucher', channelId: entry.channelId, cumulativeAmount: cumulative.toString(), signature };
        } else {
          const topUp = this.depositFor(network, requirements, extra, cumulative - BigInt(entry.deposit));
          const tx = buildTopUpTransaction({
            deployment,
            sender: this.address,
            coinType: requirements.asset,
            channelId: entry.channelId,
            amount: topUp,
            feePayer: this.options.gas === 'self' ? undefined : extra.feePayer,
          });
          payload = {
            type: 'topUp',
            ...(await this.signTransaction(network, tx)),
            channelId: entry.channelId,
            cumulativeAmount: cumulative.toString(),
            signature,
          };
          entry = { ...entry, deposit: (BigInt(entry.deposit) + topUp).toString() };
        }
      }

      const header = this.encode(paymentRequired, requirements, payload);
      return {
        header,
        requirements,
        complete: async (settlement, ok) => {
          try {
            if (ok && settlement?.success) {
              await this.channels.set({ ...entry, cumulative: payload.cumulativeAmount });
            } else if (payload.type !== 'voucher') {
              await this.reconcile(network, key, entry, existing);
            } else if (isChannelUnusable(settlement)) {
              await this.abandon(entry);
              return { ...(await this.record(url, requirements, settlement, ok)), retryable: true };
            }
            return await this.record(url, requirements, settlement, ok);
          } finally {
            release();
          }
        },
      };
    } catch (error) {
      release();
      throw error;
    }
  }

  private depositFor(network: SuiNetwork, requirements: PaymentRequirements, extra: BatchSettlementSuiExtra, needed: bigint): bigint {
    const asset = normalizeCoinType(requirements.asset);
    const configured = this.options.channels?.deposit ? resolvePrice(network, this.options.channels.deposit) : undefined;
    let deposit = configured?.asset.coinType === asset ? BigInt(configured.amount) : BigInt(extra.minDeposit ?? BigInt(requirements.amount) * 100n);
    if (deposit < needed) deposit = needed;
    const max = resolvePrice(network, this.options.channels?.maxDeposit ?? '$5');
    if (max.asset.coinType === asset && deposit > BigInt(max.amount)) {
      if (needed > BigInt(max.amount)) {
        throw new PaymentCapExceededError(`Channel deposit ${needed} exceeds maxDeposit ${max.amount}`, {
          amount: needed.toString(),
          asset,
          cap: max.amount,
          scope: 'deposit',
        });
      }
      deposit = BigInt(max.amount);
    }
    return deposit;
  }

  /** After a failed open/top-up, trust the chain: keep the channel only if it exists, with its real deposit. */
  private async reconcile(network: SuiNetwork, key: string, entry: ChannelEntry, previous: ChannelEntry | undefined) {
    const onChain = await getChannel(this.client(network), entry.channelId).catch(() => undefined);
    if (onChain === null) {
      await this.channels.delete(key);
    } else if (onChain) {
      await this.channels.set({ ...entry, deposit: onChain.deposited.toString(), cumulative: previous?.cumulative ?? '0' });
    }
  }

  /**
   * The facilitator no longer accepts this channel (closed, or our cumulative is out of sync).
   * Park it so the next payment opens a fresh one; `closeChannel` can recover its funds.
   */
  private async abandon(entry: ChannelEntry) {
    await this.channels.delete(entry.key);
    await this.channels.set({ ...entry, key: `${entry.key}#abandoned:${entry.channelId}` });
  }

  /**
   * Coin objects change with every payment that spends them, and fullnodes index the new
   * versions at checkpoint boundaries. Wait for our previous payment so the next transaction
   * is built on current object versions. (Address-balance funds have no such dependency.)
   */
  private async settled(network: SuiNetwork) {
    const digest = this.lastTransaction.get(network);
    if (!digest) return;
    await this.client(network)
      .core.waitForTransaction({ digest, timeout: 10_000 })
      .catch(() => undefined);
    this.lastTransaction.delete(network);
  }

  private async signTransaction(network: SuiNetwork, tx: Transaction) {
    await this.settled(network);
    const bytes = await tx.build({ client: this.client(network) });
    const { signature } = await this.signer.signTransaction(bytes);
    return { transaction: bytesToBase64(bytes), transactionSignature: signature };
  }

  // --- shared ----------------------------------------------------------------

  private encode(paymentRequired: PaymentRequired, requirements: PaymentRequirements, payload: unknown): string {
    const paymentPayload: PaymentPayload = {
      x402Version: X402_VERSION,
      resource: paymentRequired.resource,
      accepted: requirements,
      payload,
    };
    return encodePaymentPayload(paymentPayload);
  }

  private async record(
    url: string,
    requirements: PaymentRequirements,
    settlement: SettleResponse | null,
    ok: boolean,
  ): Promise<PaymentRecord> {
    const success = ok && (settlement?.success ?? true);
    if (success) this.spend.add(normalizeCoinType(requirements.asset), BigInt(requirements.amount));
    const onChain = settlement?.transaction && !settlement.transaction.includes(':')
      ? settlement.transaction
      : ((settlement?.extensions?.sui as { fundingTransaction?: string } | undefined)?.fundingTransaction ?? null);
    if (onChain) this.lastTransaction.set(requirements.network as SuiNetwork, onChain);
    const record: PaymentRecord = {
      url,
      scheme: requirements.scheme,
      network: requirements.network,
      asset: requirements.asset,
      amount: requirements.amount,
      payTo: requirements.payTo,
      payer: this.address,
      success,
      transaction: settlement?.transaction || undefined,
      errorReason: settlement?.errorReason,
      at: Date.now(),
    };
    await this.options.onPayment?.(record);
    return record;
  }
}

function isChannelUnusable(settlement: SettleResponse | null): boolean {
  const reason = settlement?.errorReason;
  return (
    reason === ErrorReason.batchChannelNotFound ||
    reason === ErrorReason.batchChannelClosing ||
    reason === ErrorReason.batchVoucherStale ||
    reason === ErrorReason.batchVoucherExceedsDeposit
  );
}
