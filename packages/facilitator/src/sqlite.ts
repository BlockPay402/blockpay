import type { DatabaseSync } from 'node:sqlite';
import { type ChannelRecord, type FacilitatorStore, raisesBy } from './store.js';

type Db = DatabaseSync;

/** Tables the store uses. Created if missing; compatible with the BlockPay platform schema. */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS fx_exact_transactions (
    digest TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS fx_channels (
    channel_id TEXT PRIMARY KEY,
    network TEXT NOT NULL,
    coin_type TEXT NOT NULL,
    payer TEXT NOT NULL,
    payee TEXT NOT NULL,
    operator TEXT NOT NULL,
    authorizer TEXT NOT NULL,
    deposited TEXT NOT NULL,
    accepted_amount TEXT NOT NULL,
    accepted_signature TEXT,
    claimed_amount TEXT NOT NULL,
    close_requested_at_ms TEXT,
    withdraw_delay_ms TEXT NOT NULL,
    status TEXT NOT NULL,
    last_voucher_at INTEGER,
    last_claim_at INTEGER,
    last_claim_digest TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS fx_channels_payee ON fx_channels(payee);
`;

function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

type Row = Record<string, string | number | null>;

function toRecord(row: Row): ChannelRecord {
  return {
    channelId: row.channel_id as string,
    network: row.network as string,
    coinType: row.coin_type as string,
    payer: row.payer as string,
    payee: row.payee as string,
    operator: row.operator as string,
    authorizer: row.authorizer as string,
    deposited: row.deposited as string,
    acceptedAmount: row.accepted_amount as string,
    acceptedSignature: (row.accepted_signature as string) ?? null,
    claimedAmount: row.claimed_amount as string,
    closeRequestedAtMs: (row.close_requested_at_ms as string) ?? null,
    withdrawDelayMs: row.withdraw_delay_ms as string,
    status: row.status as ChannelRecord['status'],
    lastVoucherAt: (row.last_voucher_at as number) ?? null,
    lastClaimAt: (row.last_claim_at as number) ?? null,
    lastClaimDigest: (row.last_claim_digest as string) ?? null,
    createdAt: row.created_at as number,
  };
}

/**
 * Durable facilitator state on SQLite (`node:sqlite`, Node 22.5+): replay protection and
 * channel watermarks survive restarts. Pass a `DatabaseSync` you own; tables are created
 * on construction.
 *
 * ```ts
 * import { DatabaseSync } from 'node:sqlite';
 * import { SqliteStore } from '@blockpay402/facilitator/sqlite';
 * createFacilitator({ store: new SqliteStore(new DatabaseSync('facilitator.db')), ... });
 * ```
 */
export class SqliteStore implements FacilitatorStore {
  constructor(private readonly db: Db) {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    db.exec(SCHEMA);
  }

  async reserveTransaction(digest: string) {
    const result = this.db
      .prepare('INSERT OR IGNORE INTO fx_exact_transactions (digest, created_at) VALUES (?, ?)')
      .run(digest, Date.now());
    return result.changes === 1;
  }

  async releaseTransaction(digest: string) {
    this.db.prepare('DELETE FROM fx_exact_transactions WHERE digest = ?').run(digest);
  }

  async hasTransaction(digest: string) {
    return !!this.db.prepare('SELECT 1 FROM fx_exact_transactions WHERE digest = ?').get(digest);
  }

  async getChannel(channelId: string) {
    const row = this.db.prepare('SELECT * FROM fx_channels WHERE channel_id = ?').get(channelId) as Row | undefined;
    return row ? toRecord(row) : null;
  }

  async putChannel(r: ChannelRecord) {
    transaction(this.db, () => {
      const existing = this.db
        .prepare('SELECT accepted_amount, accepted_signature FROM fx_channels WHERE channel_id = ?')
        .get(r.channelId) as Row | undefined;
      // Never move the watermark backwards.
      const keepExisting = existing && BigInt(existing.accepted_amount as string) > BigInt(r.acceptedAmount);
      this.db
        .prepare(
          `INSERT INTO fx_channels (channel_id, network, coin_type, payer, payee, operator, authorizer, deposited,
             accepted_amount, accepted_signature, claimed_amount, close_requested_at_ms, withdraw_delay_ms, status,
             last_voucher_at, last_claim_at, last_claim_digest, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(channel_id) DO UPDATE SET
             deposited = excluded.deposited, accepted_amount = excluded.accepted_amount,
             accepted_signature = excluded.accepted_signature, claimed_amount = excluded.claimed_amount,
             close_requested_at_ms = excluded.close_requested_at_ms, status = excluded.status,
             last_voucher_at = excluded.last_voucher_at, last_claim_at = excluded.last_claim_at,
             last_claim_digest = excluded.last_claim_digest`,
        )
        .run(
          r.channelId,
          r.network,
          r.coinType,
          r.payer,
          r.payee,
          r.operator,
          r.authorizer,
          r.deposited,
          keepExisting ? (existing!.accepted_amount as string) : r.acceptedAmount,
          keepExisting ? ((existing!.accepted_signature as string) ?? null) : r.acceptedSignature,
          r.claimedAmount,
          r.closeRequestedAtMs,
          r.withdrawDelayMs,
          r.status,
          r.lastVoucherAt,
          r.lastClaimAt,
          r.lastClaimDigest,
          r.createdAt,
        );
    });
  }

  async acceptVoucher(channelId: string, cumulative: bigint, signature: string, at: number, minIncrement = 1n) {
    return transaction(this.db, () => {
      const row = this.db.prepare('SELECT accepted_amount FROM fx_channels WHERE channel_id = ?').get(channelId) as
        | Row
        | undefined;
      if (!row || !raisesBy(BigInt(row.accepted_amount as string), cumulative, minIncrement)) return false;
      this.db
        .prepare('UPDATE fx_channels SET accepted_amount = ?, accepted_signature = ?, last_voucher_at = ? WHERE channel_id = ?')
        .run(cumulative.toString(), signature, at, channelId);
      return true;
    });
  }

  async listRedeemable(network: string) {
    const rows = this.db
      .prepare("SELECT * FROM fx_channels WHERE network = ? AND status != 'closed' AND accepted_amount != claimed_amount")
      .all(network) as Row[];
    return rows.map(toRecord).filter((r) => BigInt(r.acceptedAmount) > BigInt(r.claimedAmount));
  }

  async markClaimed(channelId: string, claimed: bigint, digest: string, closed: boolean, at: number) {
    transaction(this.db, () => {
      const row = this.db.prepare('SELECT claimed_amount FROM fx_channels WHERE channel_id = ?').get(channelId) as
        | Row
        | undefined;
      if (!row) return;
      const next = claimed > BigInt(row.claimed_amount as string) ? claimed.toString() : (row.claimed_amount as string);
      this.db
        .prepare(
          `UPDATE fx_channels SET claimed_amount = ?, last_claim_at = ?, last_claim_digest = ?,
             status = CASE WHEN ? THEN 'closed' ELSE status END WHERE channel_id = ?`,
        )
        .run(next, at, digest, closed ? 1 : 0, channelId);
    });
  }
}
