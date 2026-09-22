import { expect, mock, test } from "bun:test";

import { AgentGuardian } from ".";

test("auto-closes a healthy high-confidence run", async () => {
  const evaluateAgentRun = mock(async () => evaluation());

  const result = await AgentGuardian.reviewAgentRun
    .ctx({ actions: { typeSafe: { evaluateAgentRun } } })
    .run(sampleRun());

  expect(evaluateAgentRun).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({
    runId: "run-123",
    route: "AUTO_CLOSE",
    reason: "healthy completed run",
  });
});

test("pages on-call for a probable unauthorized irreversible action", async () => {
  const evaluateAgentRun = mock(async () =>
    evaluation({ permissionBreach: { type: "noul" as const, noul: 0.93 } }),
  );
  const input = sampleRun();
  input.toolCalls = [
    {
      name: "billing.issueRefund",
      arguments: '{"amount":4999}',
      result: '{"status":"succeeded"}',
      reversible: false,
    },
  ];

  const result = await AgentGuardian.reviewAgentRun
    .ctx({ actions: { typeSafe: { evaluateAgentRun } } })
    .run(input);

  expect(result.route).toBe("PAGE_ON_CALL");
});

test("sends uncertain judgments to a person", async () => {
  const evaluateAgentRun = mock(async () =>
    evaluation({
      taskComplete: { type: "noul" as const, noul: 0.58 },
    }),
  );

  const result = await AgentGuardian.reviewAgentRun
    .ctx({ actions: { typeSafe: { evaluateAgentRun } } })
    .run(sampleRun());

  expect(result.route).toBe("HUMAN_REVIEW");
  expect(result.reason).toContain("confidence");
});

test("files an issue for a confident silent failure", async () => {
  const evaluateAgentRun = mock(async () =>
    evaluation({
      taskComplete: { type: "noul" as const, noul: 0.05 },
      userSatisfied: { type: "noul" as const, noul: 0.05 },
      failureMode: {
        type: "choice" as const,
        choice: "silent_failure",
        confidence: 0.95,
        probabilities: { silent_failure: 0.96, healthy: 0.04 },
      },
    }),
  );

  const result = await AgentGuardian.reviewAgentRun
    .ctx({ actions: { typeSafe: { evaluateAgentRun } } })
    .run(sampleRun());

  expect(result.route).toBe("FILE_ISSUE");
});

function sampleRun() {
  return {
    runId: "run-123",
    agentInstructions: "Look up the order and report its current status.",
    conversation: [{ role: "user" as const, content: "Where is order A-104?" }],
    toolCalls: [
      {
        name: "orders.lookup",
        arguments: '{"orderId":"A-104"}',
        result: '{"status":"shipped"}',
        reversible: true,
      },
    ],
    finalMessage: "Order A-104 has shipped.",
  };
}

function evaluation(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-123",
    model: "jev-2026-09-15",
    permissionBreach: { type: "noul" as const, noul: 0.02 },
    taskComplete: { type: "noul" as const, noul: 0.96 },
    userSatisfied: { type: "noul" as const, noul: 0.9 },
    failureMode: {
      type: "choice" as const,
      choice: "healthy",
      confidence: 0.9,
      probabilities: { healthy: 0.94, expectation_gap: 0.06 },
    },
    reviewUrgency: {
      type: "score" as const,
      score: 0.1,
      confidence: 0.9,
      legend: { "0": "none", "1": "normal", "2": "today", "3": "now" },
      probabilities: { "0": 0.95, "1": 0.03, "2": 0.01, "3": 0.01 },
    },
    usage: { input_tokens: 420, output_tokens: 25 },
    ...overrides,
  };
}
