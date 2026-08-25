import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, it } from "vitest";

import {
  dayBriefSchema,
  listCoursesOutputSchema,
} from "../../src/tools/schemas.js";

function tomorrowInTokyo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + 86_400_000));
}

describe("authenticated MCP client E2E", () => {
  it("calls list_courses and get_day_brief through stdio without exposing result data", async () => {
    const environment = Object.fromEntries(
      Object.entries({
        ...process.env,
        WASEDA_PORTAL_HEADLESS: "true",
        WASEDA_PORTAL_CACHE: "true",
        WASEDA_PORTAL_MIN_ACCESS_INTERVAL_MS: "1000",
        WASEDA_PORTAL_MAX_COURSES: "1",
        WASEDA_PORTAL_MAX_SYLLABUS_CANDIDATES: "3",
        WASEDA_PORTAL_MAX_ASSIGNMENT_DETAILS: "1",
      }).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["dist/cli.js"],
      cwd: process.cwd(),
      env: environment,
      stderr: "pipe",
    });
    const client = new Client({ name: "waseda-live-e2e", version: "0.1.0" });
    try {
      await client.connect(transport);
      const coursesResult = await client.callTool({
        name: "list_courses",
        arguments: { includeNonRegular: false },
      });
      if (coursesResult.isError)
        throw new Error("MCP E2E list_courses returned an error");
      let courseCount: number;
      try {
        const parsed = listCoursesOutputSchema.parse(
          coursesResult.structuredContent,
        );
        courseCount = parsed.courses.length;
      } catch {
        throw new Error("MCP E2E list_courses returned a nonconforming schema");
      }
      if (courseCount < 1)
        throw new Error("MCP E2E list_courses returned no regular course");

      const briefResult = await client.callTool({
        name: "get_day_brief",
        arguments: {
          date: tomorrowInTokyo(),
          includeCompletedDeadlines: false,
        },
      });
      if (briefResult.isError)
        throw new Error("MCP E2E get_day_brief returned an error");
      try {
        dayBriefSchema.parse(briefResult.structuredContent);
      } catch {
        throw new Error(
          "MCP E2E get_day_brief returned a nonconforming schema",
        );
      }
    } finally {
      await client.close();
    }
  }, 180_000);
});
