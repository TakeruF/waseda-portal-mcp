# Architecture and source contract

The shared `UniversityAdapter` describes user-facing results (`Course`, `ClassMeeting`, `Deadline`, `CourseChange`, and `Syllabus`), not scraping mechanisms. Waseda-specific DOM rules, identifiers, and match evidence remain under `src/adapters/waseda`; source-only values belong in `extensions`.

Data flow:

1. `BrowserSession` uses one dedicated persistent Chrome context and applies `ReadOnlyGuard` to every request.
2. Each source parser converts an in-memory page snapshot directly into a small Zod-validated model. Raw authenticated HTML is never cached or persisted.
3. `WasedaAdapter` filters regular Moodle courses, resolves public syllabi conservatively, generates confirmed weekly meetings, excludes academic breaks, and overlays MyWaseda changes.
4. MCP tools return structured content plus text, with source URLs and observation timestamps retained on every result.

Priority is MyWaseda change notices, Moodle structured activity state and time, Web Syllabus schedule and room, free text, then unconfirmed inference. A close syllabus match is returned as candidates with `AMBIGUOUS_COURSE_MATCH`; it is not used to assert a meeting room or exam.

To add another university, implement `UniversityAdapter` in the same package first. Do not add provider fields to common models unless they describe a user-facing concept shared across institutions. Keep authentication, selectors, and match rules in that adapter. A package split is only justified after a second adapter demonstrates a real boundary.
