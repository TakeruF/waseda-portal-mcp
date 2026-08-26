import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, it } from "vitest";

import { searchSyllabiOutputSchema } from "../../src/tools/schemas.js";

describe("public syllabus catalog MCP client E2E", () => {
  it("searches syllabus content through stdio without logging result data", async () => {
    const environment = Object.fromEntries(
      Object.entries({
        ...process.env,
        WASEDA_PORTAL_HEADLESS: "true",
        WASEDA_PORTAL_CACHE: "true",
        WASEDA_PORTAL_MIN_ACCESS_INTERVAL_MS: "1000",
        WASEDA_PORTAL_MAX_SYLLABUS_CANDIDATES: "1",
        WASEDA_PORTAL_MAX_ASSIGNMENT_DETAILS: "0",
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
    } finally {
      await client.close();
    }
  }, 120_000);
});
