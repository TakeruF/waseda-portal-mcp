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

class AuthenticatedFixtureSources implements WasedaSources {
  constructor(private readonly syllabusValue: Syllabus) {}
  courses() {
    return Promise.resolve([
      {
        id: "course-1",
        institution: "waseda" as const,
        name: "人工知能概論",
        regular: true,
        sourceRefs: this.syllabusValue.sourceRefs,
      },
    ]);
  }
  deadlines() {
    return Promise.resolve([
      {
        id: "deadline-1",
        courseId: "course-1",
        title: "レポート",
        activityType: "assignment" as const,
        dueAt: "2026-09-05T12:00:00+09:00",
        status: "not_submitted" as const,
        url: "https://wsdmoodle.waseda.jp/mod/assign/view.php?id=1",
        sourceRefs: this.syllabusValue.sourceRefs,
      },
    ]);
  }
  changes() {
    return Promise.resolve([
      {
        id: "change-1",
        type: "cancellation" as const,
        effectiveDate: "2026-09-05",
        description: "人工知能概論は休講",
        sourceRefs: this.syllabusValue.sourceRefs,
      },
    ]);
  }
  syllabusByKey() {
    return Promise.resolve(this.syllabusValue);
  }
  syllabusCandidates() {
    return Promise.resolve([this.syllabusValue]);
  }
  searchSyllabusCatalog(input: { searchTerms: string[] }) {
    return Promise.resolve([
      { syllabus: this.syllabusValue, matchedSearchTerms: input.searchTerms },
    ]);
  }
  academicEvents() {
    return Promise.resolve([]);
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
    const html = await page.text();
    expect(html).toContain("シラバス検索");
    expect(html).toContain("試験なし（明記）");
    expect(html).toContain("曜日・評価方法などで絞り込む");
    expect(html).toContain("比較する");

    expect((await fetch(`${origin}/admin`)).status).toBe(404);
    expect((await fetch(`${origin}/api/personal/dashboard`)).status).toBe(404);
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

  it("serves the private Moodle and MyWaseda dashboard only outside public mode", async () => {
    const privateAdapter = new WasedaAdapter(
      new AuthenticatedFixtureSources(
        parseSyllabus(
          await fixtureSnapshot(
            "syllabus.html",
            "https://www.wsl.waseda.jp/syllabus/JAA104.php?pKey=SYNTH-101",
          ),
        ),
      ),
    );
    let connectionStarted = false;
    const privateServer = await startHttpServer({
      adapter: privateAdapter,
      config: publicConfig({ publicOnly: false }),
      connectPersonalSession: () => {
        connectionStarted = true;
        return Promise.resolve();
      },
    });
    try {
      const response = await fetch(
        `http://127.0.0.1:${privateServer.port}/api/personal/dashboard`,
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        courses: unknown[];
        deadlines: unknown[];
        changes: unknown[];
      };
      expect(body.courses).toHaveLength(1);
      expect(Array.isArray(body.deadlines)).toBe(true);
      expect(Array.isArray(body.changes)).toBe(true);

      const connect = await fetch(
        `http://127.0.0.1:${privateServer.port}/api/personal/connect`,
        { method: "POST" },
      );
      expect(connect.status).toBe(200);
      expect(connectionStarted).toBe(true);
    } finally {
      await privateServer.close();
    }
  });
});
