import { describe, expect, it } from "vitest";

import { detectPortalAccessFailure } from "../../src/auth/browser-session.js";

describe("portal access state", () => {
  it("returns AUTH_REQUIRED for an unauthenticated redirect without exposing credentials", () => {
    const error = detectPortalAccessFailure({
      url: "https://iaidp.ia.waseda.jp/idp/profile/SAML2/Redirect/SSO",
      text: "Login",
      status: 200,
      hadAuthenticatedCookies: false,
    });
    expect(error?.code).toBe("AUTH_REQUIRED");
    expect(error?.details).toBeUndefined();
  });

  it("distinguishes an expired saved session and maintenance", () => {
    expect(
      detectPortalAccessFailure({
        url: "https://my.waseda.jp/login/login",
        text: "Login",
        status: 200,
        hadAuthenticatedCookies: true,
      })?.code,
    ).toBe("SESSION_EXPIRED");
    expect(
      detectPortalAccessFailure({
        url: "https://wsdmoodle.waseda.jp/",
        text: "メンテナンス中です",
        status: 200,
        hadAuthenticatedCookies: false,
      })?.code,
    ).toBe("MAINTENANCE");
  });
});
