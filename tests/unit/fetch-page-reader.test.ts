import { describe, expect, it, vi } from "vitest";

import { FetchPageReader } from "../../src/adapters/waseda/fetch-page-reader.js";
import { PortalError } from "../../src/core/errors/portal-error.js";

function stubFetch(body: string, init: { status?: number } = {}) {
  return vi.fn(() =>
    Promise.resolve(
      new Response(body, {
        status: init.status ?? 200,
        headers: { "content-type": "text/html" },
      }),
    ),
  );
}

describe("FetchPageReader", () => {
  it("reads an allowed public page", async () => {
    const fetchImpl = stubFetch("<html><body>ok</body></html>");
    const reader = new FetchPageReader({ fetchImpl });
    const snapshot = await reader.read(
      "https://www.wsl.waseda.jp/syllabus/JAA104.php?pKey=abc",
    );
    expect(snapshot.html).toContain("ok");
    expect(snapshot.observedAt).toBeInstanceOf(Date);
  });

  it.each([
    "https://wsdmoodle.waseda.jp/my/courses.php",
    "https://my.waseda.jp/portal",
    "http://www.wsl.waseda.jp/syllabus/JAA101.php",
  ])("refuses %s without issuing a request", async (url) => {
    const fetchImpl = stubFetch("should not be sent");
    const reader = new FetchPageReader({ fetchImpl });
    await expect(reader.read(url)).rejects.toThrow(PortalError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts the read-only search form as url-encoded fields", async () => {
    const fetchImpl = stubFetch("<html><body>results</body></html>");
    const reader = new FetchPageReader({ fetchImpl });
    await reader.searchSyllabus("数理統計学", undefined, undefined);

    const call = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(call[0]).toBe("https://www.wsl.waseda.jp/syllabus/JAA101.php");
    const init = call[1];
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    const body = new URLSearchParams(init.body as string);
    expect(body.get("ControllerParameters")).toBe("JAA103SubCon");
    expect(body.get("kamoku")).toBe("数理統計学");
  });

  it.each([
    [429, "<html>slow down</html>", "RATE_LIMITED"],
    [503, "<html>oops</html>", "SOURCE_UNAVAILABLE"],
    [200, "<html>ただいまメンテナンス中です</html>", "MAINTENANCE"],
  ])("maps HTTP %i to %s", async (status, body, code) => {
    const reader = new FetchPageReader({
      fetchImpl: stubFetch(body, { status }),
    });
    await expect(
      reader.read("https://www.wsl.waseda.jp/syllabus/JAA104.php?pKey=abc"),
    ).rejects.toMatchObject({ code });
  });

  it("reports an unreachable source rather than leaking the transport error", async () => {
    const reader = new FetchPageReader({
      fetchImpl: (() =>
        Promise.reject(new Error("ECONNRESET"))) as unknown as typeof fetch,
    });
    await expect(
      reader.read("https://www.wsl.waseda.jp/syllabus/JAA104.php?pKey=abc"),
    ).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
  });
});
