import { afterEach, beforeEach, expect, mock, test } from "bun:test";

import { TypeSafe } from ".";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.TYPESAFE_API_KEY;
const originalModel = process.env.TYPESAFE_MODEL;

beforeEach(() => {
  process.env.TYPESAFE_API_KEY = "test-typesafe-key";
  process.env.TYPESAFE_MODEL = "jev-latest";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnvironment("TYPESAFE_API_KEY", originalApiKey);
  restoreEnvironment("TYPESAFE_MODEL", originalModel);
});

test("batches typed run judgments into one authenticated request", async () => {
  const fetchMock = mock(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    json(systemOneResponse()),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  const result = await TypeSafe.evaluateAgentRun.run(sampleRun());

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(String(url)).toBe("https://api.typesafe.ai/v1/systemone");
  expect(new Headers(init?.headers).get("authorization")).toBe(
    "Bearer test-typesafe-key",
  );
  const request = JSON.parse(String(init?.body));
  expect(request.model).toBe("jev-latest");
  expect(Object.keys(request.questions)).toEqual([
    "permission_breach",
    "task_complete",
    "user_satisfied",
    "failure_mode",
    "review_urgency",
  ]);
  expect(result.failureMode.choice).toBe("healthy");
  expect(result.usage.input_tokens).toBe(420);
});

test("fails before making a request when credentials are missing", async () => {
  delete process.env.TYPESAFE_API_KEY;
  const fetchMock = mock(async () => json({}));
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  await expect(TypeSafe.evaluateAgentRun.run(sampleRun())).rejects.toThrow(
    "TYPESAFE_API_KEY",
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

test("rejects provider responses that violate the typed contract", async () => {
  globalThis.fetch = mock(async () =>
    json({
      ...systemOneResponse(),
      answers: {
        ...systemOneResponse().answers,
        task_complete: { type: "noul", noul: 1.2 },
      },
    }),
  ) as unknown as typeof fetch;

  await expect(TypeSafe.evaluateAgentRun.run(sampleRun())).rejects.toThrow(
    "invalid task completion probability",
  );
});

function sampleRun() {
  return {
    runId: "run-123",
    agentInstructions: "Answer the user. Do not issue refunds.",
    conversation: [{ role: "user" as const, content: "Where is my order?" }],
    toolCalls: [
      {
        name: "orders.lookup",
        arguments: '{"orderId":"A-104"}',
        result: '{"status":"shipped"}',
        reversible: true,
      },
    ],
    finalMessage: "Your order has shipped.",
  };
}

function systemOneResponse() {
  return {
    model: "jev-2026-09-15",
    answers: {
      permission_breach: { type: "noul", noul: 0.01 },
      task_complete: { type: "noul", noul: 0.98 },
      user_satisfied: { type: "noul", noul: 0.9 },
      failure_mode: {
        type: "choice",
        choice: "healthy",
        confidence: 0.92,
        probabilities: {
          healthy: 0.94,
          expectation_gap: 0.03,
          overt_failure: 0.02,
          silent_failure: 0.01,
        },
      },
      review_urgency: {
        type: "score",
        score: 0.1,
        confidence: 0.91,
        legend: {
          "0": "No human review is needed.",
          "1": "Review in the normal queue.",
          "2": "Priority review is needed today.",
          "3": "Page the on-call operator now.",
        },
        probabilities: { "0": 0.92, "1": 0.06, "2": 0.01, "3": 0.01 },
      },
    },
    usage: { input_tokens: 420, output_tokens: 25 },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
