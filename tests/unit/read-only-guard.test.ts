import { describe, expect, it } from "vitest";

import { ReadOnlyGuard } from "../../src/auth/read-only-guard.js";
import { PUBLIC_WASEDA_HOSTS } from "../../src/config/urls.js";
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

describe("ReadOnlyGuard restricted to public hosts", () => {
  const guard = new ReadOnlyGuard({ allowedHosts: PUBLIC_WASEDA_HOSTS });

  it("still allows the public syllabus and academic calendar reads", () => {
    expect(() =>
      guard.assertSafeRequest(
        "GET",
        "https://www.wsl.waseda.jp/syllabus/JAA104.php?pKey=abc",
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
        "GET",
        "https://www.waseda.jp/top/about/work/organizations/academic-affairs-division/academic-calendar",
      ),
    ).not.toThrow();
  });

  it.each([
    "https://wsdmoodle.waseda.jp/my/courses.php",
    "https://my.waseda.jp/portal",
    "https://class.waseda.jp/kyuko/epb3010.htm",
    "https://iaidp.ia.waseda.jp/idp/profile/SAML2/Redirect/SSO",
    "https://evil.test/collect",
  ])("cannot reach %s", (url) => {
    expect(() => guard.assertSafeRequest("GET", url)).toThrow(PortalError);
    try {
      guard.assertSafeRequest("GET", url);
    } catch (error) {
      expect((error as PortalError).code).toBe("HOST_NOT_ALLOWED");
    }
  });

  it("rejects plain http even on an allowed host", () => {
    expect(() =>
      guard.assertSafeRequest("GET", "http://www.wsl.waseda.jp/syllabus/"),
    ).toThrow(PortalError);
  });

  it("ignores schemes that never reach a Waseda origin", () => {
    expect(() => guard.assertAllowedHost("about:blank")).not.toThrow();
    expect(() => guard.assertAllowedHost("data:text/html,x")).not.toThrow();
  });
});
