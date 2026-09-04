import fs from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import type { AppConfig } from "../config/config.js";
import { WASEDA_URLS } from "../config/urls.js";

export async function runAuth(config: AppConfig): Promise<void> {
  await fs.mkdir(config.profileDir, { recursive: true, mode: 0o700 });
  console.error(`Opening a dedicated Chrome profile at ${config.profileDir}`);
  console.error(
    "Log in through Waseda SSO yourself and wait for the Moodle course page. Credentials are never requested by this CLI.",
  );
  const context = await chromium.launchPersistentContext(config.profileDir, {
    ...(config.browserChannel === "" ? {} : { channel: config.browserChannel }),
    headless: false,
    acceptDownloads: false,
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(WASEDA_URLS.moodleCourses, {
      waitUntil: "domcontentloaded",
    });
    if (!isMoodleCoursePage(page.url()))
      await page.waitForURL((url) => isMoodleCoursePage(url.toString()), {
        timeout: 0,
        waitUntil: "domcontentloaded",
      });
    await saveAuthState(context, config.authStatePath);
    console.error(
      "Moodle state saved. Opening MyWaseda; use its login control yourself if shown.",
    );

    await page.goto(WASEDA_URLS.myWasedaLogin, {
      waitUntil: "domcontentloaded",
    });
    if (!isAuthenticatedMyWasedaPage(page.url()))
      await page.waitForURL(
        (url) => isAuthenticatedMyWasedaPage(url.toString()),
        { timeout: 0, waitUntil: "domcontentloaded" },
      );
    await saveAuthState(context, config.authStatePath);
    console.error(
      'MyWaseda state saved. In MyWaseda, open "授業" -> "授業関連" -> "休講" yourself. The CLI will only observe the destination URL.',
    );

    await waitForClassChangePage(context);
    await saveAuthState(context, config.authStatePath);
    console.error(
      "Authenticated portal state saved locally. Closing the dedicated browser.",
    );
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function waitForClassChangePage(
  context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>,
): Promise<void> {
  let contextClosed = false;
  const reportedDestinations = new Set<string>();
  const observePage = (
    page: ReturnType<typeof context.pages>[number],
  ): void => {
    const observeFrame = (rawUrl: string): void => {
      const url = new URL(rawUrl);
      if (url.origin !== "https://class.waseda.jp") return;
      const safeDestination = `${url.origin}${url.pathname}`;
      if (reportedDestinations.has(safeDestination)) return;
      reportedDestinations.add(safeDestination);
      console.error(`Observed class portal destination: ${safeDestination}`);
    };
    for (const frame of page.frames()) observeFrame(frame.url());
    page.on("framenavigated", (frame) => observeFrame(frame.url()));
  };
  for (const page of context.pages()) observePage(page);
  context.on("page", observePage);
  context.once("close", () => {
    contextClosed = true;
  });
  while (true) {
    const pages = context.pages();
    if (
      pages.some((candidate) =>
        candidate.frames().some((frame) => isClassChangePage(frame.url())),
      )
    )
      return;
    if (contextClosed)
      throw new Error(
        "The dedicated browser was closed before the class-change page was reached.",
      );
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function isMoodleCoursePage(rawUrl: string): boolean {
  const url = new URL(rawUrl);
  return (
    url.origin === "https://wsdmoodle.waseda.jp" &&
    url.pathname === "/my/courses.php"
  );
}

function isAuthenticatedMyWasedaPage(rawUrl: string): boolean {
  const url = new URL(rawUrl);
  return (
    url.origin === "https://my.waseda.jp" && !url.pathname.startsWith("/login")
  );
}

function isClassChangePage(rawUrl: string): boolean {
  const url = new URL(rawUrl);
  return (
    url.origin === "https://class.waseda.jp" &&
    url.pathname === "/kyuko/epb3010.htm"
  );
}

async function saveAuthState(
  context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>,
  authStatePath: string,
): Promise<void> {
  await fs.mkdir(path.dirname(authStatePath), {
    recursive: true,
    mode: 0o700,
  });
  await context.storageState({ path: authStatePath });
  await fs.chmod(authStatePath, 0o600);
}
