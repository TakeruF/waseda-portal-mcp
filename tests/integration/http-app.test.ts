import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { WasedaAdapter } from "../../src/adapters/waseda/waseda-adapter.js";
import type { WasedaSources } from "../../src/adapters/waseda/sources.js";
import { parseSyllabus } from "../../src/adapters/waseda/syllabus/syllabus-parser.js";
import { loadConfig, type AppConfig } from "../../src/config/config.js";
import type { Syllabus } from "../../src/core/models/schemas.js";
import {
  startHttpServer,
  type HttpServerHandle,
} from "../../src/http/http-server.js";
import { fixtureSnapshot } from "../helpers/fixtures.js";

/**
 * Only the two public reads are implemented. Every authenticated source throws,
 * so a public deployment that reached for one would fail the suite instead of
 * quietly succeeding.
 */
class PublicOnlyFixtureSources implements WasedaSources {
  constructor(private readonly syllabusValue: Syllabus) {}
  private refuse(): never {
    throw new Error("an authenticated source was read in public-only mode");
  }
  courses(): never {
    this.refuse();
  }
  deadlines(): never {
    this.refuse();
  }
  changes(): never {
    this.refuse();
  }
  academicEvents(): never {
    this.refuse();
  }
  syllabusCandidates(): never {
    this.refuse();
  }
  syllabusByKey() {
    return Promise.resolve(this.syllabusValue);
  }
  searchSyllabusCatalog(input: { searchTerms: string[] }) {
    return Promise.resolve([
      { syllabus: this.syllabusValue, matchedSearchTerms: input.searchTerms },
    ]);
  }
}

function publicConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return loadConfig({
    publicOnly: true,
    httpHost: "127.0.0.1",
    httpPort: 0,
    httpAllowedHosts: [],
    httpAllowedOrigins: [],
    httpRequestsPerMinute: 100,
    httpMaxConcurrentRequests: 4,
    cacheEnabled: false,
    ...overrides,
  });
}

describe("public-only HTTP deployment", () => {
  let handle: HttpServerHandle;
  let origin: string;
  let adapter: WasedaAdapter;

  beforeAll(async () => {
    const syllabus = parseSyllabus(
      await fixtureSnapshot(
        "syllabus.html",
        "https://www.wsl.waseda.jp/syllabus/JAA104.php?pKey=SYNTH-101",
      ),
    );
    adapter = new WasedaAdapter(new PublicOnlyFixtureSources(syllabus));
    handle = await startHttpServer({ adapter, config: publicConfig() });
    origin = `http://127.0.0.1:${handle.port}`;
  });

  afterAll(async () => {
    await handle.close();
  });

  it("reports health with the deployment mode", async () => {
    const response = await fetch(`${origin}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      mode: "public",
    });
  });

  it("serves the tester web UI and 404s unknown routes", async () => {
    const page = await fetch(`${origin}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("シラバス検索");

    expect((await fetch(`${origin}/admin`)).status).toBe(404);
  });

  it("searches the catalog over the REST API", async () => {
    const response = await fetch(`${origin}/api/syllabi/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "人工知能概論",
        mode: "course_name",
        maxResults: 1,
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      results: { syllabus: { key: string } }[];
      profileApplied: boolean;
    };
    expect(body.profileApplied).toBe(false);
    expect(body.results[0]?.syllabus.key).toBe("SYNTH-101");
  });

  it("reads one syllabus by key and rejects a malformed query", async () => {
    const detail = await fetch(`${origin}/api/syllabi/SYNTH-101`);
    expect(detail.status).toBe(200);
    expect(
      ((await detail.json()) as { match: { decision: string } }).match.decision,
    ).toBe("confirmed");

    const bad = await fetch(`${origin}/api/syllabi/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "x" }),
    });
    expect(bad.status).toBeGreaterThanOrEqual(400);
  });

  it("exposes only the public tools over the MCP endpoint", async () => {
    const client = new Client({ name: "http-app-test", version: "0.1.0" });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)),
      );
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "get_syllabus",
        "search_syllabi",
      ]);

      const result = await client.callTool({
        name: "search_syllabi",
        arguments: {
          query: "人工知能概論",
          mode: "course_name",
          maxResults: 1,
        },
      });
      expect(result.isError).toBeFalsy();
      expect(
        (
          result.structuredContent as {
            results: { syllabus: { key: string } }[];
          }
        ).results[0]?.syllabus.key,
      ).toBe("SYNTH-101");
    } finally {
      await client.close();
    }
  });

  it("rate limits a single caller", async () => {
    const limited = await startHttpServer({
      adapter,
      config: publicConfig({ httpRequestsPerMinute: 1 }),
    });
    try {
      const url = `http://127.0.0.1:${limited.port}/api/syllabi/SYNTH-101`;
      expect((await fetch(url)).status).toBe(200);
      const second = await fetch(url);
      expect(second.status).toBe(429);
      expect(second.headers.get("retry-after")).not.toBeNull();
    } finally {
      await limited.close();
    }
  });
});
