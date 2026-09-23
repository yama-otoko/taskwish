import { afterEach, expect, mock, test } from "bun:test";

import { HedgeJudge } from ".";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.TYPESAFE_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = originalApiKey;
});

test("returns typed JEV judgments for the hedge evidence", async () => {
  process.env.TYPESAFE_API_KEY = "test-key";
  globalThis.fetch = mock(async () =>
    Response.json({
      model: "jev-test",
      answers: {
        supports_put_hedge: { type: "noul", noul: 0.91 },
        horizon_matches: { type: "noul", noul: 0.88 },
        data_quality: {
          type: "choice",
          choice: "reliable",
          confidence: 0.92,
          probabilities: {
            reliable: 0.92,
            questionable: 0.07,
            insufficient: 0.01,
          },
        },
      },
      usage: { input_tokens: 220, output_tokens: 12 },
    }),
  ) as unknown as typeof fetch;

  const result = await HedgeJudge.evaluateHedgeEvidence({
    ticker: "nvda",
    question: "AI industry downturn by December 31, 2026?",
    marketSlug: "ai-industry-downturn-by-december-31-2026-857",
    yesProbability: 0.24,
    active: true,
    closed: false,
    liquidity: 250_000,
    volume: 2_900_000,
    marketEndDate: "2026-12-31T23:59:59Z",
    optionExpiration: "2027-01-15",
  });

  expect(result).toMatchObject({
    model: "jev-test",
    supportProbability: 0.91,
    horizonMatchProbability: 0.88,
    dataQuality: "reliable",
  });
});
