import { resolveNetwork, type SuiNetwork, type SuiNetworkConfig } from '@blockpay402/core';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { SuiGrpcClient } from '@mysten/sui/grpc';

export type SuiClient = ClientWithCoreApi;

/** gRPC client for a network. Public fullnodes no longer serve JSON-RPC. */
export function createSuiClient(network: SuiNetwork | SuiNetworkConfig, grpcUrl?: string): SuiGrpcClient {
  const config = typeof network === 'string' ? resolveNetwork(network) : network;
  return new SuiGrpcClient({ network: config.name, baseUrl: grpcUrl ?? config.grpcUrl });
}
