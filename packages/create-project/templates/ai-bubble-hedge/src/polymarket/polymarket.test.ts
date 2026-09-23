import { afterEach, expect, mock, test } from "bun:test";

import { Polymarket } from ".";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("loads the AI bubble YES probability from the public Gamma API", async () => {
  const fetchMock = mock(async (_input: string | URL | Request) =>
    Response.json({
      id: "123",
      slug: "ai-industry-downturn-by-december-31-2026-857",
      question: "AI industry downturn by December 31, 2026?",
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.24","0.76"]',
      active: true,
      closed: false,
      endDate: "2026-12-31T23:59:59Z",
      liquidityNum: 250_000,
      volumeNum: 2_900_000,
    }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  const result = await Polymarket.getAiBubbleMarket({});

  expect(result).toMatchObject({
    id: "123",
    yesProbability: 0.24,
    active: true,
    closed: false,
    liquidity: 250_000,
  });
  expect(fetchMock.mock.calls[0]?.[0]?.toString()).toContain(
    "/markets/slug/ai-industry-downturn-by-december-31-2026-857",
  );
});

test("rejects malformed market probabilities", async () => {
  globalThis.fetch = mock(async () =>
    Response.json({
      id: "123",
      slug: "broken-market",
      outcomes: '["Yes","No"]',
      outcomePrices: '["1.2","-0.2"]',
    }),
  ) as unknown as typeof fetch;

  await expect(
    Polymarket.getAiBubbleMarket({ marketSlug: "broken-market" }),
  ).rejects.toThrow("invalid YES probability");
});
