import {
  type PaymentRequirements,
  decodeBase64Json,
  encodeBase64Json,
  fromAtomic,
  normalizeCoinType,
  requirementsMatch,
  resolvePrice,
  toAtomic,
  toSuiNetwork,
} from '@blockpay402/core';
import { describe, expect, it } from 'vitest';

describe('amounts', () => {
  it('converts decimals to atomic units and back', () => {
    expect(toAtomic('0.001', 6)).toBe('1000');
    expect(toAtomic('1', 6)).toBe('1000000');
    expect(toAtomic('0.0001', 6)).toBe('100');
    expect(fromAtomic('1000', 6)).toBe('0.001');
    expect(fromAtomic('1000000', 6)).toBe('1');
    expect(fromAtomic(0n, 9)).toBe('0');
  });

  it('rejects precision the asset cannot hold', () => {
    expect(() => toAtomic('0.0000001', 6)).toThrow();
    expect(() => toAtomic('abc', 6)).toThrow();
  });

  it('resolves USD prices to USDC on mainnet and testnet', () => {
    const mainnet = resolvePrice('sui:mainnet', '$0.001');
    expect(mainnet.amount).toBe('1000');
    expect(mainnet.asset.coinType).toBe(
      '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    );
    expect(resolvePrice('sui:testnet', 0.0001).amount).toBe('100');
    expect(resolvePrice('sui:testnet', 1e-6).amount).toBe('1');
  });

  it('resolves explicit assets and refuses unknown coin types without decimals', () => {
    expect(resolvePrice('sui:mainnet', { amount: '5', asset: 'SUI' }).asset.decimals).toBe(9);
    expect(() => resolvePrice('sui:mainnet', { amount: '5', asset: '0x9::x::X' })).toThrow(/decimals/);
    expect(resolvePrice('sui:mainnet', { amount: '5', asset: '0x9::x::X', decimals: 2 }).asset.coinType).toBe(
      `0x${'0'.repeat(63)}9::x::X`,
    );
  });

  it('has no USD asset on localnet', () => {
    expect(() => resolvePrice('sui:localnet', '$1')).toThrow();
  });
});

describe('identifiers', () => {
  it('normalizes network names to CAIP-2', () => {
    expect(toSuiNetwork('testnet')).toBe('sui:testnet');
    expect(toSuiNetwork('sui-mainnet')).toBe('sui:mainnet');
    expect(toSuiNetwork('sui:devnet')).toBe('sui:devnet');
    expect(() => toSuiNetwork('base')).toThrow();
  });

  it('normalizes short coin type addresses', () => {
    expect(normalizeCoinType('0x2::sui::SUI')).toBe(`0x${'0'.repeat(63)}2::sui::SUI`);
  });
});

describe('codecs and matching', () => {
  const requirements: PaymentRequirements = {
    scheme: 'exact',
    network: 'sui:testnet',
    amount: '1000',
    asset: '0x2::sui::SUI',
    payTo: '0xabc',
    maxTimeoutSeconds: 60,
    extra: { b: 1, a: 'x' },
  };

  it('round-trips unicode JSON through base64', () => {
    const value = { text: 'thanh toán ⚡', n: 1 };
    expect(decodeBase64Json(encodeBase64Json(value))).toEqual(value);
  });

  it('matches requirements regardless of address padding and key order', () => {
    expect(
      requirementsMatch(requirements, {
        ...requirements,
        asset: `0x${'0'.repeat(63)}2::sui::SUI`,
        payTo: `0x${'0'.repeat(61)}abc`,
        extra: { a: 'x', b: 1 },
      }),
    ).toBe(true);
  });

  it('rejects any changed term', () => {
    expect(requirementsMatch(requirements, { ...requirements, amount: '999' })).toBe(false);
    expect(requirementsMatch(requirements, { ...requirements, payTo: '0xabd' })).toBe(false);
    expect(requirementsMatch(requirements, { ...requirements, extra: { a: 'x', b: 2 } })).toBe(false);
  });
});
