import fs from "node:fs/promises";

import type { PageSnapshot } from "../../src/auth/browser-session.js";

export async function fixtureSnapshot(
  name: string,
  url: string,
): Promise<PageSnapshot> {
  return {
    html: await fs.readFile(
      new URL(`../fixtures/${name}`, import.meta.url),
      "utf8",
    ),
    url,
    observedAt: new Date("2026-08-26T00:00:00.000Z"),
  };
}
