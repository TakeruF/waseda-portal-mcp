# Security policy

## Scope and guarantees

`waseda-portal-mcp` is intentionally local and read-only. Normal collection allows `GET`, `HEAD`, and `OPTIONS`. The only non-GET allowlist entry is the public Web Syllabus search form at `https://www.wsl.waseda.jp/syllabus/index.php` with the exact read-only controller `JAA103SubCon`; every other `POST` and known Moodle mutation path is blocked by `ReadOnlyGuard`.

The authentication command is separate. It opens a dedicated Chrome profile and leaves credential entry and submission to the user in Chrome. The server never asks for, copies, prints, or returns credentials, cookies, session tokens, student numbers, names, grades, feedback, or submitted filenames.

## Local data

The dedicated profile contains authentication material and must be protected like a password. Its default location is `~/.waseda-portal-mcp/chrome-profile`, outside this repository, with a best-effort owner-only directory mode. Override it with `WASEDA_PORTAL_PROFILE_DIR` when needed.

Only normalized model objects are cached, in process memory, for a configurable TTL. Authenticated raw HTML is not written to disk. `--no-cache` disables the normalized cache. Playwright itself persists the dedicated browser profile because that is the authentication mechanism.

## Reporting a vulnerability

Do not open a public issue containing credentials, cookies, real course data, personal information, or authenticated HTML. Contact the repository maintainer privately through the security-reporting channel shown on the GitHub repository. Include a minimal synthetic reproduction and the affected version.

This is an unofficial project and is not operated, endorsed, or supported by Waseda University.
