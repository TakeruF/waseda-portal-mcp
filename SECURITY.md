# Security policy

## Scope and guarantees

`waseda-portal-mcp` is intentionally local and read-only. Normal collection allows `GET`, `HEAD`, and `OPTIONS`. Non-GET requests are limited to two exact read operations: the public Web Syllabus search form at `https://www.wsl.waseda.jp/syllabus/JAA101.php` with controller `JAA103SubCon`, and Moodle `/lib/ajax/service.php` calls whose every method name is in the explicit read-only allowlist. Every other `POST` and known Moodle mutation path is blocked before send by `ReadOnlyGuard`.

Catalog search uses the same exact Web Syllabus allowlist entry. A name search sends one form search. A content search sends at most three serial keyword searches and reads at most five detail pages. It does not crawl or persist the catalog, and it does not use an external model or search provider.

The authentication command is separate. It opens a dedicated Chrome profile and leaves credential entry and submission to the user in Chrome. The server never asks for, copies, or prints credentials, cookies, session tokens, student numbers, grades, feedback, or submitted filenames. Live tests and reports must not print real course, assignment, or person names. Normal MCP course and syllabus results may contain source-provided course or instructor fields requested by the local user; they are never written to fixtures, snapshots, or logs.

## Local data

The dedicated profile and Playwright storage state contain authentication material and must be protected like passwords. Their defaults are `~/.waseda-portal-mcp/chrome-profile` and `~/.waseda-portal-mcp/auth-state.json`, outside this repository. The storage-state file is set to mode 0600. Override them with `WASEDA_PORTAL_PROFILE_DIR` and `WASEDA_PORTAL_AUTH_STATE_PATH` when needed. Never copy a normal Chrome profile into the dedicated profile.

Only normalized model objects are cached in process memory for a configurable TTL. Authenticated raw HTML is not written to disk. `--no-cache` disables the normalized cache. A separate owner-only mapping cache may store confirmed `courseId → syllabusKey` pairs; it does not store course names, instructor names, or portal HTML. Ambiguous matches are not persisted.

An optional self-declared academic profile may be loaded from `~/.waseda-portal-mcp/academic-profile.json`, or from `WASEDA_PORTAL_ACADEMIC_PROFILE_PATH`. It may contain affiliation, academic level, year, and a deliberately limited list of prerequisite hints. The server does not infer or scrape these values. The file must be owned by the current user and have no group or other permissions (normally 0600). Profile values are held in process memory only, are not logged or cached, and are not copied into MCP responses; only redacted advisory check statuses are returned. Because prerequisite hints may reveal course history, omit them unless needed.

## Reporting a vulnerability

Do not open a public issue containing credentials, cookies, real course data, personal information, or authenticated HTML. Contact the repository maintainer privately through the security-reporting channel shown on the GitHub repository. Include a minimal synthetic reproduction and the affected version.

This is an unofficial project and is not operated, endorsed, or supported by Waseda University.
