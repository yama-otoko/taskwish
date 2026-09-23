import { expect, mock, test } from "bun:test";

import { AiBubbleHedge } from ".";

const proposal = {
  ticker: "NVDA",
  spot: 180,
  strike: 160,
  expiration: "2027-01-15",
  limitPremium: 6,
  contracts: 1,
  accountEquity: 100_000,
  maxRiskPercent: 1,
};

function context(yesProbability = 0.24) {
  const getAiBubbleMarket = mock(async () => ({
    id: "123",
    slug: "ai-industry-downturn-by-december-31-2026-857",
    question: "AI industry downturn by December 31, 2026?",
    yesProbability,
    active: true,
    closed: false,
    endDate: "2026-12-31T23:59:59Z",
    liquidity: 250_000,
    volume: 2_900_000,
    fetchedAt: "2026-09-23T10:00:00.000Z",
  }));
  const evaluateHedgeEvidence = mock(async () => ({
    model: "jev-test",
    supportProbability: 0.91,
    horizonMatchProbability: 0.88,
    dataQuality: "reliable" as const,
    dataQualityConfidence: 0.92,
    usage: { input_tokens: 220, output_tokens: 12 },
  }));
  const buyPut = mock(async (order: {
    ticker: string;
    strike: number;
    expiration: string;
    limitPremium: number;
    contracts: number;
    approvalId: string;
  }) => ({
    orderId: "paper-123",
    mode: "paper" as const,
    status: "filled" as const,
    side: "buy" as const,
    optionType: "put" as const,
    ticker: order.ticker,
    strike: order.strike,
    expiration: order.expiration,
    premium: order.limitPremium,
    contracts: order.contracts,
    maxLoss: order.limitPremium * order.contracts * 100,
    approvalId: order.approvalId,
    filledAt: "2026-09-23T10:01:00.000Z",
  }));
  return {
    actions: {
      polymarket: { getAiBubbleMarket },
      hedgeJudge: { evaluateHedgeEvidence },
      paperBroker: { buyPut },
    },
    buyPut,
  };
}

test("stops an eligible hedge for human approval", async () => {
  const ctx = context();
  const result = await AiBubbleHedge.evaluateAiBubbleHedge
    .ctx({ actions: ctx.actions })
    .run(proposal);

  expect(result.eligible).toBe(true);
  expect(result.symbolicCalculation).toBe("sat");
  expect(result.execution.status).toBe("awaitingApproval");
  expect(ctx.buyPut).not.toHaveBeenCalled();
});

test("places an approved paper put when every symbolic guard passes", async () => {
  const ctx = context();
  const result = await AiBubbleHedge.evaluateAiBubbleHedge
    .ctx({ actions: ctx.actions })
    .run({ ...proposal, approvalId: "approval-1042" });

  expect(result.execution).toMatchObject({ mode: "paper", status: "filled" });
  expect(ctx.buyPut).toHaveBeenCalledWith({
    ticker: "NVDA",
    strike: 160,
    expiration: "2027-01-15",
    limitPremium: 6,
    contracts: 1,
    approvalId: "approval-1042",
  });
});

test("rejects a low-probability signal before paper execution", async () => {
  const ctx = context(0.1);
  const result = await AiBubbleHedge.evaluateAiBubbleHedge
    .ctx({ actions: ctx.actions })
    .run({ ...proposal, approvalId: "approval-1042" });

  expect(result.eligible).toBe(false);
  expect(result.execution.status).toBe("rejectedByPolicy");
  expect(ctx.buyPut).not.toHaveBeenCalled();
});
