import { Step } from "taskwish";

import { actor } from "./polymarket";

const DEFAULT_MARKET_SLUG =
  "ai-industry-downturn-by-december-31-2026-857";
const GAMMA_BASE_URL = "https://gamma-api.polymarket.com";

type GammaMarket = {
  id?: unknown;
  slug?: unknown;
  question?: unknown;
  outcomes?: unknown;
  outcomePrices?: unknown;
  active?: unknown;
  closed?: unknown;
  endDate?: unknown;
  liquidityNum?: unknown;
  volumeNum?: unknown;
};

export const { getAiBubbleMarket } = actor()
  .on("Command", "getAiBubbleMarket")

  .input({
    "marketSlug?": "string",
  })

  .run(
    Step("validateMarketSlug", function () {
      const marketSlug = this.input.marketSlug?.trim() || DEFAULT_MARKET_SLUG;
      if (!/^[a-z0-9-]{1,200}$/.test(marketSlug)) {
        throw new Error("marketSlug must be a valid Polymarket slug.");
      }
      return marketSlug;
    }),

    Step("fetchMarket", async function () {
      const response = await fetch(
        `${GAMMA_BASE_URL}/markets/slug/${encodeURIComponent(this.validateMarketSlug)}`,
        { headers: { accept: "application/json" } },
      );
      if (!response.ok) {
        throw new Error(
          `Polymarket Gamma API returned ${response.status} ${response.statusText}.`,
        );
      }
      return (await response.json()) as GammaMarket;
    }),

    Step("marketSignal", function () {
      const market = this.fetchMarket;
      const outcomes = stringArray(market.outcomes, "outcomes");
      const prices = stringArray(market.outcomePrices, "outcomePrices").map(
        Number,
      );
      const yesIndex = outcomes.findIndex(
        (outcome) => outcome.toLowerCase() === "yes",
      );
      if (yesIndex < 0 || prices.length !== outcomes.length) {
        throw new Error("Polymarket returned an invalid binary market.");
      }
      const yesProbability = prices[yesIndex];
      if (
        yesProbability === undefined ||
        !Number.isFinite(yesProbability) ||
        yesProbability < 0 ||
        yesProbability > 1
      ) {
        throw new Error("Polymarket returned an invalid YES probability.");
      }
      if (typeof market.id !== "string" || typeof market.slug !== "string") {
        throw new Error("Polymarket returned incomplete market identity.");
      }
      return {
        id: market.id,
        slug: market.slug,
        question:
          typeof market.question === "string" ? market.question : "",
        yesProbability,
        active: market.active === true,
        closed: market.closed === true,
        endDate: typeof market.endDate === "string" ? market.endDate : "",
        liquidity:
          typeof market.liquidityNum === "number" ? market.liquidityNum : 0,
        volume: typeof market.volumeNum === "number" ? market.volumeNum : 0,
        fetchedAt: new Date().toISOString(),
      };
    }),
  )

  .meta({
    description:
      "Fetch the live YES probability for Polymarket's AI industry downturn market",
    input: {
      marketSlug: {
        description: "Polymarket market slug to query through the Gamma API",
        example: DEFAULT_MARKET_SLUG,
      },
    },
  });

function stringArray(value: unknown, name: string): string[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new Error(`Polymarket returned invalid ${name}.`);
    }
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error(`Polymarket returned invalid ${name}.`);
  }
  return parsed;
}
