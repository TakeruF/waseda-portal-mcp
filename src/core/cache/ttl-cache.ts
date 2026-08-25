export class TtlCache {
  readonly #entries = new Map<string, { value: unknown; expiresAt: number }>();
  readonly #inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly enabled: boolean,
    private readonly ttlMs: number,
  ) {}

  async getOrLoad<T>(key: string, loader: () => Promise<T>): Promise<T> {
    if (this.enabled) {
      const entry = this.#entries.get(key);
      if (entry !== undefined && entry.expiresAt > Date.now())
        return entry.value as T;
    }
    const running = this.#inflight.get(key);
    if (running !== undefined) return running as Promise<T>;
    const pending = loader();
    this.#inflight.set(key, pending);
    try {
      const value = await pending;
      if (this.enabled)
        this.#entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
      return value;
    } finally {
      this.#inflight.delete(key);
    }
  }

  clear(): void {
    this.#entries.clear();
    this.#inflight.clear();
  }
}
