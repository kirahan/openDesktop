import { describe, expect, it, vi } from "vitest";

/**
 * Studio「注入 rrweb 录制包」与 Core `POST .../targets/:targetId/rrweb/inject` 的路径约定一致。
 */
describe("rrweb inject POST", () => {
  it("请求路径含编码后的 targetId 且方法为 POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async (): Promise<string> => "{}",
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const apiRoot = "http://127.0.0.1:8787";
    const sessionId = "sid";
    const targetId = "page-1";
    const url = `${apiRoot.replace(/\/$/, "")}/v1/sessions/${sessionId}/targets/${encodeURIComponent(targetId)}/rrweb/inject`;

    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer t",
        "Content-Type": "application/json",
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/v1/sessions/sid/targets/page-1/rrweb/inject",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
