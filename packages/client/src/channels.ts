/** Client-side state for one payment channel. Holds the voucher key: keep it as safe as a wallet key. */
export interface ChannelEntry {
  key: string;
  network: string;
  channelId: string;
  nonce: string;
  payTo: string;
  asset: string;
  operator: string;
  /** `suiprivkey…` of the Ed25519 voucher key. It can only pay `payTo`, up to `deposit`. */
  authorizerSecret: string;
  deposit: string;
  /** Last cumulative amount signed and accepted. */
  cumulative: string;
  createdAt: number;
}

export interface ChannelStore {
  get(key: string): Promise<ChannelEntry | undefined>;
  set(entry: ChannelEntry): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<ChannelEntry[]>;
}

export class MemoryChannelStore implements ChannelStore {
  private readonly entries = new Map<string, ChannelEntry>();
  async get(key: string) {
    const entry = this.entries.get(key);
    return entry ? { ...entry } : undefined;
  }
  async set(entry: ChannelEntry) {
    this.entries.set(entry.key, { ...entry });
  }
  async delete(key: string) {
    this.entries.delete(key);
  }
  async list() {
    return [...this.entries.values()].map((e) => ({ ...e }));
  }
}

/** Persists channels to a JSON file (Node only) so an agent keeps its channels across restarts. */
export class FileChannelStore implements ChannelStore {
  private cache: Map<string, ChannelEntry> | undefined;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async get(key: string) {
    const entry = (await this.load()).get(key);
    return entry ? { ...entry } : undefined;
  }
  async set(entry: ChannelEntry) {
    (await this.load()).set(entry.key, { ...entry });
    await this.save();
  }
  async delete(key: string) {
    (await this.load()).delete(key);
    await this.save();
  }
  async list() {
    return [...(await this.load()).values()].map((e) => ({ ...e }));
  }

  private async load() {
    if (this.cache) return this.cache;
    const fs = await import('node:fs/promises');
    try {
      const entries = JSON.parse(await fs.readFile(this.path, 'utf8')) as ChannelEntry[];
      this.cache = new Map(entries.map((e) => [e.key, e]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.cache = new Map();
    }
    return this.cache;
  }

  private save() {
    this.writing = this.writing.then(async () => {
      const fs = await import('node:fs/promises');
      const tmp = `${this.path}.tmp`;
      await fs.writeFile(tmp, JSON.stringify([...this.cache!.values()], null, 2), { mode: 0o600 });
      await fs.rename(tmp, this.path);
    });
    return this.writing;
  }
}

/** Serializes work per key: one in-flight voucher per channel keeps cumulative amounts in order. */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async acquire(key: string): Promise<() => void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => current);
    this.tails.set(key, tail);
    await previous;
    return () => {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    };
  }
}
