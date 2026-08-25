import { describe, expect, it, vi } from "vitest";

import { TtlCache } from "../../src/core/cache/ttl-cache.js";

describe("TtlCache", () => {
  it("deduplicates concurrent source reads even when retained caching is disabled", async () => {
    const loader = vi.fn(() => Promise.resolve(["normalized"]));
    const cache = new TtlCache(false, 0);
    const [first, second] = await Promise.all([
      cache.getOrLoad("source", loader),
      cache.getOrLoad("source", loader),
    ]);
    expect(first).toEqual(["normalized"]);
    expect(second).toEqual(["normalized"]);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
