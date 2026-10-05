/** Channel bookkeeping the facilitator keeps between verify, settle and redemption. */
export interface ChannelRecord {
  channelId: string;
  network: string;
  coinType: string;
  payer: string;
  payee: string;
  operator: string;
  /** Base64 Ed25519 public key that signs vouchers. */
  authorizer: string;
  /** Total deposited on-chain, as last observed. */
  deposited: string;
  /** Highest voucher accepted (the off-chain watermark). */
  acceptedAmount: string;
  acceptedSignature: string | null;
  /** Amount already redeemed on-chain. */
  claimedAmount: string;
  closeRequestedAtMs: string | null;
  withdrawDelayMs: string;
  status: 'open' | 'closing' | 'closed';
  lastVoucherAt: number | null;
  lastClaimAt: number | null;
  lastClaimDigest: string | null;
  createdAt: number;
}

export interface FacilitatorStore {
  /** Reserve an `exact` transaction digest for settlement. False if it was already reserved. */
  reserveTransaction(digest: string): Promise<boolean>;
  releaseTransaction(digest: string): Promise<void>;
  hasTransaction(digest: string): Promise<boolean>;

  getChannel(channelId: string): Promise<ChannelRecord | null>;
  /** Insert or update a channel's on-chain view. Must not move `acceptedAmount` backwards. */
  putChannel(record: ChannelRecord): Promise<void>;
  /** Atomically raise the watermark. False unless `cumulative` exceeds the current one. */
  acceptVoucher(channelId: string, cumulative: bigint, signature: string, at: number): Promise<boolean>;
  /** Channels with accepted value not yet redeemed on-chain. */
  listRedeemable(network: string): Promise<ChannelRecord[]>;
  markClaimed(channelId: string, claimed: bigint, digest: string, closed: boolean, at: number): Promise<void>;
}

export class MemoryStore implements FacilitatorStore {
  readonly transactions = new Set<string>();
  readonly channels = new Map<string, ChannelRecord>();

  async reserveTransaction(digest: string) {
    if (this.transactions.has(digest)) return false;
    this.transactions.add(digest);
    return true;
  }

  async releaseTransaction(digest: string) {
    this.transactions.delete(digest);
  }

  async hasTransaction(digest: string) {
    return this.transactions.has(digest);
  }

  async getChannel(channelId: string) {
    const record = this.channels.get(channelId);
    return record ? { ...record } : null;
  }

  async putChannel(record: ChannelRecord) {
    const existing = this.channels.get(record.channelId);
    if (existing && BigInt(existing.acceptedAmount) > BigInt(record.acceptedAmount)) {
      record = { ...record, acceptedAmount: existing.acceptedAmount, acceptedSignature: existing.acceptedSignature };
    }
    this.channels.set(record.channelId, { ...record });
  }

  async acceptVoucher(channelId: string, cumulative: bigint, signature: string, at: number) {
    const record = this.channels.get(channelId);
    if (!record || cumulative <= BigInt(record.acceptedAmount)) return false;
    record.acceptedAmount = cumulative.toString();
    record.acceptedSignature = signature;
    record.lastVoucherAt = at;
    return true;
  }

  async listRedeemable(network: string) {
    return [...this.channels.values()]
      .filter(
        (r) => r.network === network && r.status !== 'closed' && BigInt(r.acceptedAmount) > BigInt(r.claimedAmount),
      )
      .map((r) => ({ ...r }));
  }

  async markClaimed(channelId: string, claimed: bigint, digest: string, closed: boolean, at: number) {
    const record = this.channels.get(channelId);
    if (!record) return;
    if (claimed > BigInt(record.claimedAmount)) record.claimedAmount = claimed.toString();
    record.lastClaimAt = at;
    record.lastClaimDigest = digest;
    if (closed) record.status = 'closed';
  }
}
