import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, it } from "vitest";

import { BrowserSession } from "../../src/auth/browser-session.js";
import { loadConfig } from "../../src/config/config.js";
import { WASEDA_URLS } from "../../src/config/urls.js";
import { PortalError } from "../../src/core/errors/portal-error.js";

describe("unauthenticated live classification", () => {
  it("classifies a fresh dedicated profile as AUTH_REQUIRED", async () => {
    const profileDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "waseda-portal-auth-state-"),
    );
    const browser = new BrowserSession(
      loadConfig({
        profileDir,
        authStatePath: path.join(profileDir, "missing-auth-state.json"),
        headless: true,
        cacheEnabled: false,
      }),
    );
    try {
      let classified = false;
      try {
        await browser.read(WASEDA_URLS.moodleCourses);
      } catch (error) {
        classified =
          error instanceof PortalError && error.code === "AUTH_REQUIRED";
      }
      if (!classified)
        throw new Error(
          "Fresh-profile authentication was not classified as AUTH_REQUIRED",
        );
      if (browser.auditSnapshot().mutationRequestsAllowed !== 0)
        throw new Error(
          "A mutation request was allowed during authentication-state testing",
        );
    } finally {
      await browser.close();
      await fs.rm(profileDir, { recursive: true, force: true });
    }
  }, 60_000);
});
