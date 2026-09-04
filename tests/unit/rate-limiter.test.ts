import { describe, expect, it } from "vitest";

import {
  ConcurrencyGate,
  TokenBucketRateLimiter,
} from "../../src/http/rate-limiter.js";

describe("TokenBucketRateLimiter", () => {
  it("allows a full bucket and then rejects with a retry hint", () => {
    const limiter = new TokenBucketRateLimiter(3);
    const start = 1_000_000;
    for (let attempt = 0; attempt < 3; attempt += 1)
      expect(limiter.take("client", start).allowed).toBe(true);
    const rejected = limiter.take("client", start);
    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps clients independent", () => {
    const limiter = new TokenBucketRateLimiter(1);
    const now = 1_000_000;
    expect(limiter.take("a", now).allowed).toBe(true);
    expect(limiter.take("a", now).allowed).toBe(false);
    expect(limiter.take("b", now).allowed).toBe(true);
  });

  it("refills over time", () => {
    const limiter = new TokenBucketRateLimiter(60);
    const start = 1_000_000;
    expect(limiter.take("client", start).allowed).toBe(true);
    expect(limiter.take("client", start).allowed).toBe(true);
    // 60 per minute refills one token per second.
    expect(limiter.take("client", start + 1_000).allowed).toBe(true);
  });

  it("prunes only buckets that have refilled completely", () => {
    const limiter = new TokenBucketRateLimiter(60);
    const start = 1_000_000;
    limiter.take("client", start);
    limiter.prune(start);
    // Still rate limited after an ineffective prune at capacity minus one.
    expect(limiter.take("client", start).allowed).toBe(true);
    limiter.prune(start + 600_000);
    expect(limiter.take("client", start + 600_000).allowed).toBe(true);
  });
});

describe("ConcurrencyGate", () => {
  it("caps simultaneous permits and releases exactly once", () => {
    const gate = new ConcurrencyGate(2);
    const first = gate.tryAcquire();
    const second = gate.tryAcquire();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(gate.tryAcquire()).toBeUndefined();
    expect(gate.active).toBe(2);
    first?.();
    first?.();
    expect(gate.active).toBe(1);
    second?.();
    expect(gate.active).toBe(0);
    expect(gate.tryAcquire()).toBeDefined();
  });
});
