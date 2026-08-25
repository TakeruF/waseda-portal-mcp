import fs from "node:fs/promises";

import { chromium } from "playwright";

import type { AppConfig } from "../config/config.js";
import { WASEDA_URLS } from "../config/urls.js";

export async function runAuth(config: AppConfig): Promise<void> {
  await fs.mkdir(config.profileDir, { recursive: true, mode: 0o700 });
  console.error(`Opening a dedicated Chrome profile at ${config.profileDir}`);
  console.error(
    "Log in to MyWaseda yourself, then close the Chrome window. Credentials are never requested by this CLI.",
  );
  const context = await chromium.launchPersistentContext(config.profileDir, {
    channel: "chrome",
    headless: false,
    acceptDownloads: false,
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(WASEDA_URLS.myWasedaLogin, { waitUntil: "domcontentloaded" });
  await new Promise<void>((resolve) => page.once("close", () => resolve()));
  await context.close().catch(() => undefined);
}
