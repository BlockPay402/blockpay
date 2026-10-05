/** Rolling record of what was spent, per coin type, for daily caps and reporting. */
export class SpendTracker {
  private readonly entries: Array<{ asset: string; amount: bigint; at: number }> = [];

  add(asset: string, amount: bigint, at = Date.now()) {
    this.entries.push({ asset, amount, at });
    // Keep a little over a day of history.
    const horizon = at - 2 * 86_400_000;
    while (this.entries.length && this.entries[0]!.at < horizon) this.entries.shift();
  }

  spentSince(asset: string, since: number): bigint {
    return this.entries.filter((e) => e.asset === asset && e.at >= since).reduce((sum, e) => sum + e.amount, 0n);
  }
}
