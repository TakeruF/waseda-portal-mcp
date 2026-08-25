import { describe, expect, it } from "vitest";

import { ReadOnlyGuard } from "../../src/auth/read-only-guard.js";
import { PortalError } from "../../src/core/errors/portal-error.js";

describe("ReadOnlyGuard", () => {
  const guard = new ReadOnlyGuard();

  it("allows ordinary reads and the exact public syllabus search request", () => {
    expect(() =>
      guard.assertSafeRequest(
        "GET",
        "https://wsdmoodle.waseda.jp/mod/assign/view.php?id=1",
      ),
    ).not.toThrow();
    expect(() =>
      guard.assertSafeRequest(
        "POST",
        "https://wsdmoodle.waseda.jp/lib/ajax/service.php?sesskey=redacted",
        JSON.stringify([
          {
            index: 0,
            methodname:
              "core_course_get_enrolled_courses_by_timeline_classification",
            args: {},
          },
        ]),
      ),
    ).not.toThrow();
    expect(() =>
      guard.assertSafeRequest(
        "POST",
        "https://www.wsl.waseda.jp/syllabus/JAA101.php",
        "kamoku=test&ControllerParameters=JAA103SubCon",
      ),
    ).not.toThrow();
    expect(() =>
      guard.assertSafeRequest(
        "POST",
        "https://www.wsl.waseda.jp/syllabus/JAA101.php",
        '--boundary\r\nContent-Disposition: form-data; name="ControllerParameters"\r\n\r\nJAA103SubCon\r\n--boundary--',
      ),
    ).not.toThrow();
  });

  it.each([
    ["POST", "https://wsdmoodle.waseda.jp/mod/assign/view.php?id=1"],
    ["GET", "https://wsdmoodle.waseda.jp/mod/quiz/attempt.php?attempt=1"],
    ["GET", "https://wsdmoodle.waseda.jp/calendar/event.php?action=delete"],
    ["POST", "https://www.wsl.waseda.jp/syllabus/index.php"],
    ["POST", "https://wsdmoodle.waseda.jp/lib/ajax/service.php"],
  ])("blocks unsafe request %s %s", (method, url) => {
    expect(() => guard.assertSafeRequest(method, url)).toThrow(PortalError);
  });

  it("redacts likely secrets in diagnostic URLs", () => {
    expect(
      guard.redactUrl("https://example.test/?token=secret&view=1"),
    ).toContain("token=%5BREDACTED%5D");
  });
});
