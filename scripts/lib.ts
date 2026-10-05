import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Secp256k1Keypair } from '@mysten/sui/keypairs/secp256k1';
import { Secp256r1Keypair } from '@mysten/sui/keypairs/secp256r1';

export type Network = 'mainnet' | 'testnet' | 'devnet' | 'localnet';

const GRPC: Record<Network, string> = {
  mainnet: 'https://fullnode.mainnet.sui.io:443',
  testnet: 'https://fullnode.testnet.sui.io:443',
  devnet: 'https://fullnode.devnet.sui.io:443',
  localnet: 'http://127.0.0.1:9000',
};

export function parseNetwork(value: string | undefined): Network {
  const name = (value ?? '').replace(/^sui[:-]/, '');
  if (!(name in GRPC)) throw new Error(`Network must be one of: ${Object.keys(GRPC).join(', ')}`);
  return name as Network;
}

export function client(network: Network) {
  const upper = network.toUpperCase();
  return new SuiGrpcClient({ network, baseUrl: process.env[`SUI_GRPC_URL_${upper}`] ?? process.env.SUI_GRPC_URL ?? GRPC[network] });
}

export function keypair(envName: string) {
  const secret = process.env[envName];
  if (!secret) throw new Error(`${envName} is not set (suiprivkey1…)`);
  const { scheme, secretKey } = decodeSuiPrivateKey(secret);
  if (scheme === 'ED25519') return Ed25519Keypair.fromSecretKey(secretKey);
  if (scheme === 'Secp256k1') return Secp256k1Keypair.fromSecretKey(secretKey);
  if (scheme === 'Secp256r1') return Secp256r1Keypair.fromSecretKey(secretKey);
  throw new Error(`Unsupported key scheme ${scheme}`);
}

export const formatSui = (mist: bigint | string) => `${(Number(BigInt(mist)) / 1e9).toFixed(4)} SUI`;

export function die(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}
