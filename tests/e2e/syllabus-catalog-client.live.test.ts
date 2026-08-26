import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "vitest";

import { searchSyllabiOutputSchema } from "../../src/tools/schemas.js";

describe("public syllabus catalog MCP client E2E", () => {
  it("searches syllabus content through stdio without logging result data", async () => {
    const profileDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "waseda-catalog-e2e-profile-"),
    );
    const profilePath = path.join(profileDirectory, "academic-profile.json");
    await fs.writeFile(
      profilePath,
      JSON.stringify({
        schemaVersion: 1,
        affiliations: ["例示学部"],
        academicLevel: "undergraduate",
        year: 3,
      }),
      { mode: 0o600 },
    );
    const environment = Object.fromEntries(
      Object.entries({
        ...process.env,
        WASEDA_PORTAL_HEADLESS: "true",
        WASEDA_PORTAL_CACHE: "true",
        WASEDA_PORTAL_MIN_ACCESS_INTERVAL_MS: "1000",
        WASEDA_PORTAL_MAX_SYLLABUS_CANDIDATES: "1",
        WASEDA_PORTAL_MAX_ASSIGNMENT_DETAILS: "0",
        WASEDA_PORTAL_ACADEMIC_PROFILE_PATH: profilePath,
      }).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["dist/cli.js"],
      cwd: process.cwd(),
      env: environment,
      stderr: "pipe",
    });
    const client = new Client({
      name: "waseda-catalog-live-e2e",
      version: "0.1.0",
    });
    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "search_syllabi",
        arguments: {
          query: "日本の貨幣の歴史を学びたい",
          mode: "content",
          relatedTerms: ["貨幣"],
          maxResults: 1,
        },
      });
      if (result.isError)
        throw new Error("MCP E2E search_syllabi returned an error");
      const parsed = searchSyllabiOutputSchema.parse(result.structuredContent);
      if (parsed.results.length < 1)
        throw new Error("MCP E2E search_syllabi returned no safe candidates");
      if (
        !parsed.profileApplied ||
        parsed.results.some((hit) => hit.eligibility === undefined)
      )
        throw new Error("MCP E2E did not apply the synthetic academic profile");
    } finally {
      await client.close();
      await fs.rm(profileDirectory, { recursive: true, force: true });
    }
  }, 120_000);
});
