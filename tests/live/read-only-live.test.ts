import { describe, expect, it } from "vitest";

import { WasedaAdapter } from "../../src/adapters/waseda/waseda-adapter.js";
import { LiveWasedaSources } from "../../src/adapters/waseda/sources.js";
import { BrowserSession } from "../../src/auth/browser-session.js";
import { loadConfig } from "../../src/config/config.js";
import { PortalError } from "../../src/core/errors/portal-error.js";
import { TtlCache } from "../../src/core/cache/ttl-cache.js";

describe.runIf(process.env.WASEDA_LIVE_TEST === "1")(
  "read-only live smoke test",
  () => {
    it("lists a small authenticated course view or safely reports authentication is required", async () => {
      const config = loadConfig({ headless: true, cacheEnabled: false });
      const browser = new BrowserSession(config);
      const adapter = new WasedaAdapter(
        new LiveWasedaSources(browser, new TtlCache(false, 0)),
      );
      try {
        const courses = await adapter.listCourses();
        expect(courses.every((course) => course.regular)).toBe(true);
        expect(courses.every((course) => course.sourceRefs.length > 0)).toBe(
          true,
        );
      } catch (error) {
        expect(error).toBeInstanceOf(PortalError);
        expect(["AUTH_REQUIRED", "SESSION_EXPIRED"]).toContain(
          (error as PortalError).code,
        );
      } finally {
        await browser.close();
      }
    }, 60_000);
  },
);
