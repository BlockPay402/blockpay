import {
  type ChannelDeployment,
  ErrorReason,
  type FacilitatorClient,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleRequest,
  type SettleResponse,
  type SupportedKind,
  type SupportedResponse,
  type SuiNetwork,
  type VerifyRequest,
  type VerifyResponse,
  VerifyRequestSchema,
  X402_VERSION,
  isSuiNetwork,
  normalizeAddress,
  requirementsMatch,
  sameAddress,
  resolveAsset,
  resolveNetwork,
} from '@blockpay402/core';
import { type SuiClient, createSuiClient, resolveSigner } from '@blockpay402/sui';
import type { Signer } from '@mysten/sui/cryptography';
import { type Logger, type NetworkContext, type SponsorPolicy, silentLogger } from './context.js';
import { type RedeemPolicy, type RedeemResult, Redeemer, defaultRedeemPolicy } from './redeemer.js';
import { BatchSettlementSuiScheme } from './schemes/batch.js';
import { ExactSuiScheme } from './schemes/exact.js';
import { type FacilitatorStore, MemoryStore } from './store.js';

export interface NetworkOptions {
  network: SuiNetwork;
  /** gRPC endpoint. Defaults to the public fullnode. */
  grpcUrl?: string;
  client?: SuiClient;
  /** Accepted assets: symbols (`USDC`) or coin types. Default: every registered asset. */
  assets?: string[];
  /** Enables `batch-settlement`. Required on networks without a canonical deployment. */
  channel?: ChannelDeployment;
  /** Withdraw delay required of new channels. Default 1 hour. */
  withdrawDelayMs?: number;
  /** Re-read a channel from chain at least this often while accepting vouchers. Default 30s. */
  channelStateTtlMs?: number;
}

export interface SettledEvent {
  scheme: string;
  network: string;
  requirements: PaymentRequirements;
  payload: PaymentPayload;
  response: SettleResponse;
  /** Caller identity returned by `authenticate`, when the HTTP API is used. */
  caller?: CallerContext;
}

export interface CallerContext {
  id: string;
  /** Restrict which `payTo` addresses this caller may verify/settle for. */
  allowedPayTo?: string[];
  [key: string]: unknown;
}

export interface FacilitatorHooks {
  /** Runs before built-in verification. Return `{ accept: false, reason }` to reject. */
  beforeVerify?(input: {
    payload: PaymentPayload;
    requirements: PaymentRequirements;
    caller?: CallerContext;
  }): Promise<{ accept: true } | { accept: false; reason: string }>;
  onSettled?(event: SettledEvent): void | Promise<void>;
  onRedeemed?(event: RedeemResult & { network: string }): void | Promise<void>;
}

export interface FacilitatorConfig {
  networks: NetworkOptions[];
  /** Pays gas for sponsored payments and redemptions; also the channel `operator`. */
  signer?: Signer;
  privateKey?: string;
  sponsor?: Partial<SponsorPolicy>;
  store?: FacilitatorStore;
  redeem?: Partial<RedeemPolicy> & { autoStart?: boolean };
  hooks?: FacilitatorHooks;
  logger?: Logger;
}

type Scheme = ExactSuiScheme | BatchSettlementSuiScheme;

export class Facilitator implements FacilitatorClient {
  readonly address: string;
  readonly store: FacilitatorStore;
  readonly redeemers = new Map<SuiNetwork, Redeemer>();
  private readonly contexts = new Map<SuiNetwork, NetworkContext>();
  private readonly schemes = new Map<string, Scheme>();
  private readonly hooks: FacilitatorHooks;
  private readonly logger: Logger;

  constructor(config: FacilitatorConfig) {
    const signer = resolveSigner(config);
    this.address = normalizeAddress(signer.toSuiAddress());
    this.store = config.store ?? new MemoryStore();
    this.hooks = config.hooks ?? {};
    this.logger = config.logger ?? silentLogger;
    const sponsor: SponsorPolicy = {
      exact: config.sponsor?.exact ?? true,
      channels: config.sponsor?.channels ?? true,
      maxGasBudget: config.sponsor?.maxGasBudget ?? 50_000_000n,
    };
    const redeemPolicy = { ...defaultRedeemPolicy, ...config.redeem };

    for (const options of config.networks) {
      const networkConfig = resolveNetwork(options.network, { grpcUrl: options.grpcUrl, channel: options.channel });
      const ctx: NetworkContext = {
        network: options.network,
        client: options.client ?? createSuiClient(networkConfig),
        assets: new Set((options.assets ?? []).map((a) => resolveAsset(options.network, a).coinType)),
        channel: networkConfig.channel,
        withdrawDelayMs: options.withdrawDelayMs ?? 3_600_000,
        channelStateTtlMs: options.channelStateTtlMs ?? 30_000,
        signer,
        address: this.address,
        sponsor,
        store: this.store,
        logger: this.logger,
      };
      this.contexts.set(options.network, ctx);
      this.schemes.set(`exact|${options.network}`, new ExactSuiScheme(ctx));
      if (ctx.channel) {
        this.schemes.set(`batch-settlement|${options.network}`, new BatchSettlementSuiScheme(ctx));
        const redeemer = new Redeemer(ctx, redeemPolicy, (result) =>
          this.hooks.onRedeemed?.({ ...result, network: options.network }),
        );
        this.redeemers.set(options.network, redeemer);
        if (config.redeem?.autoStart !== false) redeemer.start();
      }
    }
  }

  async supported(): Promise<SupportedResponse> {
    const kinds: SupportedKind[] = [];
    for (const ctx of this.contexts.values()) {
      kinds.push({
        x402Version: X402_VERSION,
        scheme: 'exact',
        network: ctx.network,
        ...(ctx.sponsor.exact ? { extra: { feePayer: this.address } } : {}),
      });
      if (ctx.channel) {
        kinds.push({
          x402Version: X402_VERSION,
          scheme: 'batch-settlement',
          network: ctx.network,
          extra: {
            operator: this.address,
            channelPackage: ctx.channel.packageId,
            channelRegistry: ctx.channel.registryId,
            withdrawDelayMs: ctx.withdrawDelayMs,
            ...(ctx.sponsor.channels ? { feePayer: this.address } : {}),
          },
        });
      }
    }
    return { kinds, extensions: [], signers: { 'sui:*': [this.address] } };
  }

  verify(request: VerifyRequest, caller?: CallerContext): Promise<VerifyResponse> {
    return this.run('verify', request, caller, async (scheme, payload, requirements) => {
      const hook = await this.hooks.beforeVerify?.({ payload, requirements, caller });
      if (hook && !hook.accept) return { isValid: false, invalidReason: hook.reason };
      return scheme.verify(payload, requirements);
    });
  }

  settle(request: SettleRequest, caller?: CallerContext): Promise<SettleResponse> {
    return this.run('settle', request, caller, async (scheme, payload, requirements) => {
      const hook = await this.hooks.beforeVerify?.({ payload, requirements, caller });
      if (hook && !hook.accept) {
        return { success: false, errorReason: hook.reason, transaction: '', network: requirements.network };
      }
      const response = await scheme.settle(payload, requirements);
      if (response.success) {
        await Promise.resolve(
          this.hooks.onSettled?.({ scheme: scheme.scheme, network: requirements.network, requirements, payload, response, caller }),
        ).catch((error) => this.logger.error('hook.onSettled.failed', { error: String(error) }));
      }
      return response;
    });
  }

  /** Redeem accepted vouchers now (e.g. from an admin endpoint). */
  async redeemNow(network: SuiNetwork, channelIds?: string[]): Promise<RedeemResult[]> {
    const redeemer = this.redeemers.get(network);
    return redeemer ? redeemer.runOnce({ force: true, channelIds }) : [];
  }

  close() {
    for (const redeemer of this.redeemers.values()) redeemer.stop();
  }

  get networks(): SuiNetwork[] {
    return [...this.contexts.keys()];
  }

  context(network: SuiNetwork): NetworkContext | undefined {
    return this.contexts.get(network);
  }

  private async run<R extends VerifyResponse | SettleResponse>(
    kind: 'verify' | 'settle',
    request: VerifyRequest,
    caller: CallerContext | undefined,
    fn: (scheme: Scheme, payload: PaymentPayload, requirements: PaymentRequirements) => Promise<R>,
  ): Promise<R> {
    const fail = (reason: string, network = request?.paymentRequirements?.network ?? '') =>
      (kind === 'verify'
        ? { isValid: false, invalidReason: reason }
        : { success: false, errorReason: reason, transaction: '', network }) as R;

    const parsed = VerifyRequestSchema.safeParse(request);
    if (!parsed.success) {
      const version = (request as { x402Version?: unknown })?.x402Version;
      return fail(version !== X402_VERSION ? ErrorReason.invalidX402Version : ErrorReason.invalidPayload);
    }
    const { paymentPayload: payload, paymentRequirements: requirements } = request;
    if (!requirementsMatch(payload.accepted, requirements)) return fail(ErrorReason.requirementsMismatch);
    if (!isSuiNetwork(requirements.network) || !this.contexts.has(requirements.network)) {
      return fail(ErrorReason.invalidNetwork);
    }
    const ctx = this.contexts.get(requirements.network)!;
    const scheme = this.schemes.get(`${requirements.scheme}|${requirements.network}`);
    if (!scheme) return fail(ErrorReason.unsupportedScheme);
    if (ctx.assets.size > 0 && !ctx.assets.has(safeAsset(ctx.network, requirements.asset))) {
      return fail(ErrorReason.invalidPaymentRequirements);
    }
    if (caller?.allowedPayTo && !caller.allowedPayTo.some((a) => sameAddress(a, requirements.payTo))) {
      return fail(ErrorReason.payToNotAllowed);
    }
    try {
      return await fn(scheme, payload, requirements);
    } catch (error) {
      this.logger.error(`${kind}.unexpected`, { error: String((error as Error)?.stack ?? error) });
      return fail(kind === 'verify' ? ErrorReason.unexpectedVerifyError : ErrorReason.unexpectedSettleError);
    }
  }
}

export function createFacilitator(config: FacilitatorConfig): Facilitator {
  return new Facilitator(config);
}

function safeAsset(network: SuiNetwork, asset: string): string {
  try {
    return resolveAsset(network, asset, 0).coinType;
  } catch {
    return asset;
  }
}
