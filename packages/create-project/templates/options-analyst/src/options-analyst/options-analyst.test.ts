import { expect, mock, test } from "bun:test";

import { OptionsAnalyst } from ".";

test("calculates with symbolic models before asking the mocked OpenAI agent", async () => {
  const generate = mock(
    async (_options: { prompt: string; abortSignal?: AbortSignal }) =>
      "Delta is the main directional exposure.",
  );

  const result = await OptionsAnalyst.analyzeCall
    .ctx({ agent: { generate } })
    .run({
      spot: 100,
      strike: 100,
      rate: 0.05,
      volatility: 0.2,
      daysToExpiry: 365,
      contracts: 2,
      spotMovePercent: 1,
    });

  expect(result.snapshot.symbolicCalculation).toBe("sat");
  expect(result.snapshot.perShare.theoreticalPrice).toBeCloseTo(10.4506, 3);
  expect(result.snapshot.perShare.delta).toBeCloseTo(0.6368, 3);
  expect(result.snapshot.perShare.gamma).toBeCloseTo(0.01876, 4);
  expect(result.snapshot.perShare.vegaPerPoint).toBeCloseTo(0.37524, 4);
  expect(result.snapshot.perShare.thetaPerDay).toBeCloseTo(-0.01757, 4);
  expect(result.snapshot.perShare.rhoPerPoint).toBeCloseTo(0.53232, 4);
  expect(result.snapshot.position.deltaEquivalentShares).toBeCloseTo(
    127.37,
    1,
  );
  expect(result.analysis).toContain("Delta");
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate.mock.calls[0]?.[0]?.prompt).toContain(
    '"symbolicCalculation":"sat"',
  );
});

test("rejects invalid inputs before invoking the agent", async () => {
  const generate = mock(async () => "unused");

  await expect(
    OptionsAnalyst.analyzeCall.ctx({ agent: { generate } }).run({
      spot: 100,
      strike: 100,
      rate: 0.05,
      volatility: 0,
      daysToExpiry: 30,
    }),
  ).rejects.toThrow("volatility must be greater than zero");
  expect(generate).not.toHaveBeenCalled();
});
