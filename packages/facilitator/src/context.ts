import type { ChannelDeployment, SuiNetwork } from '@blockpay402/core';
import type { SuiClient } from '@blockpay402/sui';
import type { Signer } from '@mysten/sui/cryptography';
import type { FacilitatorStore } from './store.js';

export interface Logger {
  debug?(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

export interface SponsorPolicy {
  /** Sponsor gas for `exact` payments that are not gasless. Default true. */
  exact: boolean;
  /** Sponsor gas for channel open / top-up. Default true. */
  channels: boolean;
  /** Highest gas budget the sponsor will co-sign, in MIST. Default 0.05 SUI. */
  maxGasBudget: bigint;
}

/** Everything a scheme needs for one network. */
export interface NetworkContext {
  network: SuiNetwork;
  client: SuiClient;
  /** Coin types accepted on this network (normalized). Empty: any. */
  assets: Set<string>;
  channel?: ChannelDeployment;
  withdrawDelayMs: number;
  /** How long cached channel state is trusted before re-reading it from chain. */
  channelStateTtlMs: number;
  signer: Signer;
  address: string;
  sponsor: SponsorPolicy;
  store: FacilitatorStore;
  logger: Logger;
}
