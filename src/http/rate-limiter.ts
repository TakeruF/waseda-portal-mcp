export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds a rejected caller should wait before retrying. Zero when allowed. */
  retryAfterSeconds: number;
}

/**
 * Per-client token bucket.
 *
 * A shared deployment reaches Waseda from a single address, so fairness
 * between callers has to be enforced here; the serial limiter in
 * `LiveWasedaSources` only bounds the aggregate upstream rate.
 */
export class TokenBucketRateLimiter {
  readonly #buckets = new Map<string, { tokens: number; updatedAt: number }>();
  readonly #capacity: number;
  readonly #tokensPerMs: number;

  constructor(requestsPerMinute: number) {
    this.#capacity = Math.max(1, Math.floor(requestsPerMinute));
    this.#tokensPerMs = this.#capacity / 60_000;
  }

  take(clientKey: string, now: number = Date.now()): RateLimitDecision {
    const bucket = this.#buckets.get(clientKey);
    const tokens =
      bucket === undefined
        ? this.#capacity
        : Math.min(
            this.#capacity,
            bucket.tokens + (now - bucket.updatedAt) * this.#tokensPerMs,
          );
    if (tokens < 1) {
      this.#buckets.set(clientKey, { tokens, updatedAt: now });
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((1 - tokens) / this.#tokensPerMs / 1000),
        ),
      };
    }
    this.#buckets.set(clientKey, { tokens: tokens - 1, updatedAt: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Drops buckets that have refilled completely, so the map cannot grow without bound. */
  prune(now: number = Date.now()): void {
    for (const [key, bucket] of this.#buckets) {
      if (
        bucket.tokens + (now - bucket.updatedAt) * this.#tokensPerMs >=
        this.#capacity
      )
        this.#buckets.delete(key);
    }
  }
}

/**
 * Caps how many requests may occupy the shared browser at once. Each permit is
 * released exactly once, however many times the returned function is called.
 */
export class ConcurrencyGate {
  #active = 0;
  readonly #max: number;

  constructor(max: number) {
    this.#max = Math.max(1, Math.floor(max));
  }

  get active(): number {
    return this.#active;
  }

  tryAcquire(): (() => void) | undefined {
    if (this.#active >= this.#max) return undefined;
    this.#active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active -= 1;
    };
  }
}
