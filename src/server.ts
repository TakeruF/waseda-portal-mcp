import { McpServer } from "@modelcontextprotocol/server";

import type { WasedaAdapter } from "./adapters/waseda/waseda-adapter.js";
import { asPortalError } from "./core/errors/portal-error.js";
import { listCoursesInputSchema } from "./core/models/inputs.js";
import { getDayBrief } from "./tools/day-brief.js";
import {
  dayBriefSchema,
  getDayBriefInputSchema,
  getSyllabusInputSchema,
  getSyllabusOutputSchema,
  listChangesOutputSchema,
  listChangesToolInputSchema,
  listCoursesOutputSchema,
  listDeadlinesOutputSchema,
  listDeadlinesToolInputSchema,
  searchSyllabiInputSchema,
  searchSyllabiOutputSchema,
} from "./tools/schemas.js";

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

function success<T extends Record<string, unknown>>(value: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function failure(error: unknown) {
  const portalError = asPortalError(error);
  const value = {
    error: {
      code: portalError.code,
      message: portalError.message,
      details: portalError.details ?? {},
    },
  };
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

export function createMcpServer(adapter: WasedaAdapter): McpServer {
  const server = new McpServer(
    { name: "waseda-portal-mcp", version: "0.1.0" },
    {
      instructions:
        "Unofficial read-only Waseda portal integration. Use search_syllabi with mode=course_name for any known title and mode=content for a learning goal. For content discovery, provide up to three concise relatedTerms when useful. Treat provenance and warnings as authoritative; never infer enrollment eligibility, a room, exam, or syllabus match when ambiguity is reported.",
    },
  );

  server.registerTool(
    "get_day_brief",
    {
      title: "Get Waseda day brief",
      description:
        "Combine classes, class changes, deadlines due that day, and unresolved overdue deadlines.",
      inputSchema: getDayBriefInputSchema,
      outputSchema: dayBriefSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ date, includeCompletedDeadlines }) => {
      try {
        return success(
          await getDayBrief(adapter, date, includeCompletedDeadlines),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "list_courses",
    {
      title: "List Waseda Moodle courses",
      description:
        "List regular Moodle courses, optionally including guidance and other non-regular courses.",
      inputSchema: listCoursesInputSchema,
      outputSchema: listCoursesOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) => {
      try {
        return success(
          listCoursesOutputSchema.parse({
            courses: await adapter.listCourses(input),
            observedAt: new Date().toISOString(),
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "list_deadlines",
    {
      title: "List Waseda Moodle deadlines",
      description:
        "List structured Moodle activity deadlines without grades, feedback, or submitted filenames.",
      inputSchema: listDeadlinesToolInputSchema,
      outputSchema: listDeadlinesOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) => {
      try {
        return success(
          listDeadlinesOutputSchema.parse({
            deadlines: await adapter.listDeadlines(input),
            observedAt: new Date().toISOString(),
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "list_changes",
    {
      title: "List Waseda class changes",
      description:
        "List cancellation and change notices from the authenticated MyWaseda initial view.",
      inputSchema: listChangesToolInputSchema,
      outputSchema: listChangesOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) => {
      try {
        return success(
          listChangesOutputSchema.parse({
            changes: await adapter.listChanges(input),
            observedAt: new Date().toISOString(),
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_syllabus",
    {
      title: "Get a Waseda syllabus",
      description:
        "Resolve a course to Web Syllabus using weighted evidence, or return candidates without asserting an ambiguous match.",
      inputSchema: getSyllabusInputSchema,
      outputSchema: getSyllabusOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) => {
      try {
        return success(
          getSyllabusOutputSchema.parse({
            match: await adapter.getSyllabusMatch(input),
            observedAt: new Date().toISOString(),
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "search_syllabi",
    {
      title: "Search the Waseda syllabus catalog",
      description:
        "Search all current Web Syllabi without requiring Moodle enrollment. Use mode=course_name for a known title. Use mode=content for a learning goal or topic; relatedTerms may contain up to three concise topic synonyms. If an owner-only local academic profile exists, useAcademicProfile=true adds advisory affiliation, year, and prerequisite checks without returning profile values.",
      inputSchema: searchSyllabiInputSchema,
      outputSchema: searchSyllabiOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) => {
      try {
        const query = searchSyllabiInputSchema.parse(input);
        const result = await adapter.searchSyllabi(query);
        return success(
          searchSyllabiOutputSchema.parse({
            query: query.query,
            mode: query.mode,
            ...result,
            warnings: [
              ...(query.mode === "content"
                ? [
                    "Content relevance is lexical and based on the official full-field Web Syllabus search.",
                  ]
                : []),
              ...(result.profileApplied
                ? [
                    "Eligibility checks are advisory; confirm school-specific rules, registration periods, capacity, and free-text conditions in official sources.",
                  ]
                : ["Confirm enrollment rules separately."]),
            ],
            observedAt: new Date().toISOString(),
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}
