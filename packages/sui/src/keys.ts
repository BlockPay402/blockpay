import { decodeSuiPrivateKey, type Keypair, type Signer } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Secp256k1Keypair } from '@mysten/sui/keypairs/secp256k1';
import { Secp256r1Keypair } from '@mysten/sui/keypairs/secp256r1';
import { fromBase64, fromHex } from '@mysten/sui/utils';

export type { Signer };

/**
 * Load a keypair from:
 * - a Bech32 secret (`suiprivkey1…`, any scheme)
 * - a 32-byte Ed25519 secret as hex (`0x…`)
 * - a base64 Sui keystore entry (`flag || secret`)
 */
export function loadKeypair(secret: string): Keypair {
  const value = secret.trim();
  if (value.startsWith('suiprivkey')) {
    const { scheme, secretKey } = decodeSuiPrivateKey(value);
    switch (scheme) {
      case 'ED25519':
        return Ed25519Keypair.fromSecretKey(secretKey);
      case 'Secp256k1':
        return Secp256k1Keypair.fromSecretKey(secretKey);
      case 'Secp256r1':
        return Secp256r1Keypair.fromSecretKey(secretKey);
      default:
        throw new Error(`Unsupported key scheme: ${scheme}`);
    }
  }
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(value)) {
    return Ed25519Keypair.fromSecretKey(fromHex(value.replace(/^0x/, '')));
  }
  const bytes = fromBase64(value);
  if (bytes.length === 33) {
    const [flag] = bytes;
    const key = bytes.slice(1);
    if (flag === 0x00) return Ed25519Keypair.fromSecretKey(key);
    if (flag === 0x01) return Secp256k1Keypair.fromSecretKey(key);
    if (flag === 0x02) return Secp256r1Keypair.fromSecretKey(key);
  }
  throw new Error('Unrecognized private key format');
}

/** Accept either a ready signer (KMS, hardware, wallet adapter) or a secret string. */
export function resolveSigner(input: { signer?: Signer; privateKey?: string }): Signer {
  if (input.signer) return input.signer;
  if (input.privateKey) return loadKeypair(input.privateKey);
  throw new Error('Provide either "signer" or "privateKey"');
}
