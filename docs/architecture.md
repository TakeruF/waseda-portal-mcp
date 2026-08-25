# Architecture and source contract

The shared `UniversityAdapter` describes user-facing results (`Course`, `ClassMeeting`, `Deadline`, `CourseChange`, and `Syllabus`), not scraping mechanisms. Waseda-specific DOM rules, identifiers, and match evidence remain under `src/adapters/waseda`; source-only values belong in `extensions`.

Data flow:

1. `BrowserSession` uses one dedicated persistent Chrome context, restores an owner-only storage-state file outside the repository, and applies `ReadOnlyGuard` to every request.
2. Each source parser converts an in-memory page snapshot directly into a small Zod-validated model. Raw authenticated HTML is never cached or persisted.
3. `WasedaAdapter` filters regular Moodle courses, resolves public syllabi conservatively, persists only confirmed ID-to-key mappings, generates confirmed weekly meetings, excludes academic breaks, and overlays MyWaseda changes.
4. MCP tools return structured content plus text, with source URLs and observation timestamps retained on every result.

Live source reads pass through one serial limiter. Authenticated validation uses one course, one assignment detail at most, one Web Syllabus search, three syllabus candidates at most, and a one-second minimum interval. Priority is MyWaseda change notices, Moodle structured activity state and time, Web Syllabus schedule and room, free text, then unconfirmed inference. A weak or close syllabus match is returned as ambiguous candidates; it is not used to assert a meeting room or exam.

To add another university, implement `UniversityAdapter` in the same package first. Do not add provider fields to common models unless they describe a user-facing concept shared across institutions. Keep authentication, selectors, and match rules in that adapter. A package split is only justified after a second adapter demonstrates a real boundary.
