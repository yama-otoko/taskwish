import { afterEach, beforeEach, expect, test } from "bun:test";

import { Beeper } from ".";

const originalFetch = globalThis.fetch;
const originalToken = process.env.BEEPER_ACCESS_TOKEN;
const originalURL = process.env.BEEPER_API_URL;

beforeEach(() => {
  process.env.BEEPER_ACCESS_TOKEN = "test-token";
  process.env.BEEPER_API_URL = "http://127.0.0.1:23373";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.BEEPER_ACCESS_TOKEN;
  else process.env.BEEPER_ACCESS_TOKEN = originalToken;
  if (originalURL === undefined) delete process.env.BEEPER_API_URL;
  else process.env.BEEPER_API_URL = originalURL;
});

test("discovers all connected accounts and available bridges", async () => {
  const paths: string[] = [];
  globalThis.fetch = (async (input) => {
    paths.push(new URL(String(input)).pathname);
    return json({ ok: true });
  }) as typeof fetch;

  const result = await Beeper.discoverIntegrations.run();

  expect(paths.sort()).toEqual([
    "/v1/accounts",
    "/v1/bridges",
    "/v1/info",
    "/v1/labels",
  ]);
  expect(result).toEqual({
    info: { ok: true },
    accounts: { ok: true },
    bridges: { ok: true },
    labels: { ok: true },
  });
});

test("sends a reply with an attachment through any chat network", async () => {
  let request: { url: string; authorization: string | null; body: unknown } | undefined;
  globalThis.fetch = (async (input, init) => {
    request = {
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)),
    };
    return json({ pendingMessageID: "pending-1" });
  }) as typeof fetch;

  const result = await Beeper.sendMessage.run({
    chatId: "!room/id",
    text: "Shipping now",
    replyToMessageId: "message-1",
    uploadId: "upload-1",
    fileName: "report.pdf",
    mimeType: "application/pdf",
  });

  expect(result).toEqual({ pendingMessageID: "pending-1" });
  expect(request).toEqual({
    url: "http://127.0.0.1:23373/v1/chats/!room%2Fid/messages",
    authorization: "Bearer test-token",
    body: {
      text: "Shipping now",
      replyToMessageID: "message-1",
      attachment: {
        uploadID: "upload-1",
        fileName: "report.pdf",
        mimeType: "application/pdf",
      },
    },
  });
});

test("keeps generic calls inside the versioned Beeper API", async () => {
  globalThis.fetch = (async () =>
    json({ ok: true })) as unknown as typeof fetch;

  await expect(
    Beeper.callBeeperApi.run({ method: "GET", path: "https://example.com/v1/accounts" }),
  ).rejects.toThrow("path must stay inside");
});

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}
