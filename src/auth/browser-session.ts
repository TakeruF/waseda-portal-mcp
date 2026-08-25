import fs from "node:fs/promises";

import {
  chromium,
  type BrowserContext,
  type Page,
  type Response,
} from "playwright";

import type { AppConfig } from "../config/config.js";
import { PortalError } from "../core/errors/portal-error.js";
import { ReadOnlyGuard } from "./read-only-guard.js";

export interface PageSnapshot {
  url: string;
  html: string;
  observedAt: Date;
}

export interface PageReader {
  read(url: string): Promise<PageSnapshot>;
}

export interface SyllabusPageReader extends PageReader {
  searchSyllabus(courseName: string): Promise<PageSnapshot>;
}

export interface PortalAccessState {
  url: string;
  text: string;
  status?: number;
  hadAuthenticatedCookies: boolean;
}

export function detectPortalAccessFailure(
  state: PortalAccessState,
): PortalError | undefined {
  if (state.status === 429)
    return new PortalError(
      "RATE_LIMITED",
      "The source rate-limited the request",
    );
  if (state.status !== undefined && state.status >= 500) {
    return new PortalError(
      "SOURCE_UNAVAILABLE",
      `The source returned HTTP ${state.status}`,
    );
  }
  if (/メンテナンス|maintenance|サービス停止/i.test(state.text)) {
    return new PortalError(
      "MAINTENANCE",
      "The Waseda service is under maintenance",
    );
  }
  const authenticationPage =
    /\/login(?:\/|\?|$)|auth\/saml|my\.waseda\.jp\/login|iaidp\.ia\.waseda\.jp/i.test(
      state.url,
    ) ||
    state.status === 401 ||
    state.status === 403;
  if (!authenticationPage) return undefined;
  return new PortalError(
    state.hadAuthenticatedCookies ? "SESSION_EXPIRED" : "AUTH_REQUIRED",
    state.hadAuthenticatedCookies
      ? "The saved Waseda session has expired; run `waseda-portal-mcp auth` again"
      : "Authentication is required; run `waseda-portal-mcp auth`",
  );
}

export class BrowserSession implements PageReader {
  readonly #guard = new ReadOnlyGuard();
  #contextPromise: Promise<BrowserContext> | undefined;

  constructor(private readonly config: AppConfig) {}

  async read(url: string): Promise<PageSnapshot> {
    this.#guard.assertSafeRequest("GET", url);
    const context = await this.context();
    const hadAuthenticatedCookies = await this.hasWasedaSession(context);
    const page = await context.newPage();
    try {
      const response = await this.navigate(page, url);
      await this.detectFailure(page, response, hadAuthenticatedCookies);
      return {
        url: page.url(),
        html: await page.content(),
        observedAt: new Date(),
      };
    } finally {
      await page.close();
    }
  }

  async searchSyllabus(courseName: string): Promise<PageSnapshot> {
    const context = await this.context();
    const page = await context.newPage();
    try {
      const initial = await this.navigate(
        page,
        "https://www.wsl.waseda.jp/syllabus/JAA101.php?pLng=jp",
      );
      await this.detectFailure(page, initial, false);
      await page.locator('input[name="kamoku"]').fill(courseName);
      await page
        .locator('input[name="ControllerParameters"]')
        .evaluate((element) => {
          (element as HTMLInputElement).value = "JAA103SubCon";
        });
      await Promise.all([
        page.waitForURL(/\/syllabus\/index\.php/, {
          waitUntil: "domcontentloaded",
        }),
        page
          .locator("form#cForm")
          .evaluate((form) => (form as HTMLFormElement).submit()),
      ]);
      await this.detectFailure(page, null, false);
      return {
        url: page.url(),
        html: await page.content(),
        observedAt: new Date(),
      };
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    if (this.#contextPromise !== undefined)
      await (await this.#contextPromise).close();
    this.#contextPromise = undefined;
  }

  private context(): Promise<BrowserContext> {
    this.#contextPromise ??= this.createContext();
    return this.#contextPromise;
  }

  private async createContext(): Promise<BrowserContext> {
    await fs.mkdir(this.config.profileDir, { recursive: true, mode: 0o700 });
    const context = await chromium.launchPersistentContext(
      this.config.profileDir,
      {
        channel: "chrome",
        headless: this.config.headless,
        acceptDownloads: false,
        serviceWorkers: "block",
      },
    );
    context.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
    await context.route("**/*", async (route) => {
      try {
        this.#guard.assertSafeRequest(
          route.request().method(),
          route.request().url(),
          route.request().postData(),
        );
        await route.continue();
      } catch {
        await route.abort("blockedbyclient");
      }
    });
    return context;
  }

  private async navigate(page: Page, url: string): Promise<Response | null> {
    try {
      return await page.goto(url, { waitUntil: "domcontentloaded" });
    } catch (error) {
      if (error instanceof PortalError) throw error;
      throw new PortalError(
        "SOURCE_UNAVAILABLE",
        "Could not open the Waseda source",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  private async detectFailure(
    page: Page,
    response: Response | null,
    hadAuthenticatedCookies: boolean,
  ): Promise<void> {
    const titleAndBody = `${await page.title()} ${(
      await page
        .locator("body")
        .innerText()
        .catch(() => "")
    ).slice(0, 4000)}`;
    const error = detectPortalAccessFailure({
      url: page.url(),
      text: titleAndBody,
      ...(response === null ? {} : { status: response.status() }),
      hadAuthenticatedCookies,
    });
    if (error !== undefined) throw error;
  }

  private async hasWasedaSession(context: BrowserContext): Promise<boolean> {
    const cookies = await context.cookies([
      "https://my.waseda.jp",
      "https://wsdmoodle.waseda.jp",
      "https://iaidp.ia.waseda.jp",
    ]);
    return cookies.some((cookie) => !cookie.name.startsWith("_ga"));
  }
}
