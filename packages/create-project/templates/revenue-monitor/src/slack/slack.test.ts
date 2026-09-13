import { afterEach, expect, test } from "bun:test";

import { Slack } from ".";

const originalFetch = globalThis.fetch;
const originalToken = process.env.TW_SLACK_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.TW_SLACK_API_KEY;
  else process.env.TW_SLACK_API_KEY = originalToken;
});

test("posts alerts through the Slack Web API", async () => {
  process.env.TW_SLACK_API_KEY = "test-token";
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    request = { url: String(input), init };
    return new Response(
      JSON.stringify({ ok: true, channel: "C123", ts: "123.456" }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const result = await Slack.postMessage.run({
    channel: "C123",
    text: "Revenue is below target",
  });

  expect(result.ok).toBe(true);
  expect(request?.url).toBe("https://slack.com/api/chat.postMessage");
  expect(new Headers(request?.init?.headers).get("authorization")).toBe(
    "Bearer test-token",
  );
});
