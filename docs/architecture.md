# Architecture and source contract

The shared `UniversityAdapter` describes user-facing results (`Course`, `ClassMeeting`, `Deadline`, `CourseChange`, and `Syllabus`), not scraping mechanisms. Waseda-specific DOM rules, identifiers, and match evidence remain under `src/adapters/waseda`; source-only values belong in `extensions`.

Data flow:

1. `BrowserSession` uses one dedicated persistent Chrome context, restores an owner-only storage-state file outside the repository, and applies `ReadOnlyGuard` to every request.
2. Each source parser converts an in-memory page snapshot directly into a small Zod-validated model. Raw authenticated HTML is never cached or persisted.
3. `WasedaAdapter` filters regular Moodle courses, resolves public syllabi conservatively, persists only confirmed ID-to-key mappings, generates confirmed weekly meetings, excludes academic breaks, and overlays MyWaseda changes.
4. MCP tools return structured content plus text, with source URLs and observation timestamps retained on every result.

Live source reads pass through one serial limiter. Authenticated validation uses one course, one assignment detail at most, one Web Syllabus search, three syllabus candidates at most, and a one-second minimum interval. Priority is MyWaseda change notices, Moodle structured activity state and time, Web Syllabus schedule and room, free text, then unconfirmed inference. A weak or close syllabus match is returned as ambiguous candidates; it is not used to assert a meeting room or exam.

Catalog discovery is independent of Moodle enrollment. `course_name` uses the official partial-title field once. `content` uses the official full-field keyword search with one to three explicit or locally segmented terms. Candidate URLs are deduplicated before at most five detail reads, then ranked lexically from official matches and parsed syllabus fields. No catalog corpus or query result is persisted to disk.

An optional owner-only academic profile is loaded once at process startup from outside the repository. It is self-declared and never populated from authenticated portals. Catalog results may be annotated with redacted advisory checks for explicit target-student fields, allocated year, and prerequisite or registration-condition text. Offering school is not treated as an affiliation restriction, free text is not used to assert eligibility, and unknown conditions never remove a candidate. The source profile values are not placed in tool results, logs, snapshots, or caches.

Two deployment modes share one adapter. The default is authenticated, single-user, and stdio. `--public-only` restricts `ReadOnlyGuard` to the public Waseda hosts, skips the stored storage state, the academic profile, and the mapping cache, and registers only the catalog tools; `serve-http` then exposes that same server over MCP streamable HTTP alongside a JSON API and a static web UI, so an MCP client and a browser reach identical data through one process. Client fairness lives in the HTTP layer; upstream volume stays bounded by the existing serial limiter and the normalized cache.

To add another university, implement `UniversityAdapter` in the same package first. Do not add provider fields to common models unless they describe a user-facing concept shared across institutions. Keep authentication, selectors, and match rules in that adapter. A package split is only justified after a second adapter demonstrates a real boundary.
