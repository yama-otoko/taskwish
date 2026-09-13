import { expect, mock, test } from "bun:test";

import { CournotCompetition } from ".";

test("solves the Nash equilibrium before asking Claude to explain it", async () => {
  const generate = mock(
    async (_options: { prompt: string; abortSignal?: AbortSignal }) =>
      "Neither producer can gain by moving alone.",
  );

  const result = await CournotCompetition.analyzeCompetition
    .ctx({ agent: { generate } })
    
    .run({
      marketDemand: 120,
      producerACost: 18,
      producerBCost: 24,
      capacity: 60,
    });

  expect(result.equilibrium).toMatchObject({
    outputA: 36,
    outputB: 30,
    marketPrice: 54,
    profitA: 1296,
    profitB: 900,
  });
  expect(result.explanation).toContain("Neither producer");
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate.mock.calls[0]?.[0]?.prompt).toContain('"outputA":36');
});

test("models a producer whose best response is constrained by capacity", async () => {
  const result = await CournotCompetition.analyzeCompetition
    .ctx({ agent: { generate: mock(async () => "Capacity binds.") } })

    .run({
      marketDemand: 120,
      producerACost: 18,
      producerBCost: 24,
      capacity: 20,
    });

  expect(result.equilibrium).toMatchObject({
    outputA: 20,
    outputB: 20,
    marketPrice: 80,
  });
});
