import { describe, expect, it } from "vitest";

import {
  jstDayBounds,
  normalizeSourceDateTime,
  weekdayForDate,
} from "../../src/core/time/jst.js";

describe("Asia/Tokyo time handling", () => {
  it("creates explicit JST day boundaries", () => {
    expect(jstDayBounds("2026-08-27")).toEqual({
      from: "2026-08-27T00:00:00+09:00",
      to: "2026-08-27T23:59:59+09:00",
    });
  });

  it("interprets source timestamps without a zone as JST", () => {
    expect(normalizeSourceDateTime("2026年8月27日 00:30")).toBe(
      "2026-08-27T00:30:00+09:00",
    );
    expect(Date.parse("2026-08-27T00:30:00+09:00")).toBe(
      Date.parse("2026-08-26T15:30:00Z"),
    );
  });

  it("calculates the local weekday at JST noon", () => {
    expect(weekdayForDate("2026-08-27")).toBe(4);
  });
});
