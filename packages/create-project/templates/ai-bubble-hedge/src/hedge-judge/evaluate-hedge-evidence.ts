import {
  ModelChoice,
  ModelNoul,
  Step,
  TypeSafe,
  assertProbability,
} from "taskwish";

import { actor } from "./hedge-judge";

export const { evaluateHedgeEvidence } = actor()
  .on("Command", "evaluateHedgeEvidence")

  .input({
    ticker: "string",
    question: "string",
    marketSlug: "string",
    yesProbability: "number",
    active: "boolean",
    closed: "boolean",
    liquidity: "number",
    volume: "number",
    marketEndDate: "string",
    optionExpiration: "string",
  })

  .run(
    Step("evidence", function () {
      const ticker = this.input.ticker.trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) {
        throw new Error("ticker must be a valid stock symbol.");
      }
      if (
        !Number.isFinite(this.input.yesProbability) ||
        this.input.yesProbability < 0 ||
        this.input.yesProbability > 1
      ) {
        throw new Error("yesProbability must be between zero and one.");
      }
      return { ...this.input, ticker };
    }),

    TypeSafe("judge", {
      state: (scope) => ({
        prediction_market: {
          question: scope.evidence.question,
          slug: scope.evidence.marketSlug,
          yes_probability: scope.evidence.yesProbability,
          active: scope.evidence.active,
          closed: scope.evidence.closed,
          liquidity_usd: scope.evidence.liquidity,
          volume_usd: scope.evidence.volume,
          resolution_date: scope.evidence.marketEndDate,
        },
        proposed_hedge: {
          ticker: scope.evidence.ticker,
          option_type: "put",
          expiration: scope.evidence.optionExpiration,
        },
        limitations: [
          "Prediction-market probability is a noisy signal, not a stock-return forecast.",
          "The Polymarket resolution basket and the selected ticker are not identical exposures.",
        ],
      }),
      questions: {
        supports_put_hedge: ModelNoul(
          "Does this evidence support considering a defined-risk put hedge on the selected ticker, without treating it as sufficient on its own?",
        ),
        horizon_matches: ModelNoul(
          "Does the option expiration provide meaningful overlap with the prediction market's resolution horizon?",
        ),
        data_quality: ModelChoice(
          "Classify the prediction-market signal quality for this limited use.",
          {
            reliable: "The supplied market is active, liquid, and directly relevant.",
            questionable: "The signal is usable only with material caveats.",
            insufficient: "The signal should not be used for this decision.",
          },
        ),
      },
    }),

    Step("evaluation", function () {
      const answers = this.judge.answers;
      assertProbability("put-hedge support", answers.supports_put_hedge.noul);
      assertProbability("horizon match", answers.horizon_matches.noul);
      assertProbability("data-quality confidence", answers.data_quality.confidence);
      return {
        model: this.judge.model,
        supportProbability: answers.supports_put_hedge.noul,
        horizonMatchProbability: answers.horizon_matches.noul,
        dataQuality: answers.data_quality.choice,
        dataQualityConfidence: answers.data_quality.confidence,
        usage: this.judge.usage,
      };
    }),
  )

  .meta({
    description:
      "Use the TypeSafe JEV model to judge whether the Polymarket signal is relevant enough for a put-hedge policy",
    input: {
      ticker: { description: "Stock or ETF symbol", example: "NVDA" },
      question: { description: "Polymarket resolution question" },
      marketSlug: { description: "Polymarket market slug" },
      yesProbability: { description: "Current Polymarket YES price", example: 0.24 },
      active: { description: "Whether Polymarket marks the market active" },
      closed: { description: "Whether Polymarket marks the market closed" },
      liquidity: { description: "Reported market liquidity in USD" },
      volume: { description: "Reported market volume in USD" },
      marketEndDate: { description: "Prediction-market resolution date" },
      optionExpiration: { description: "Proposed put expiration", example: "2027-01-15" },
    },
  });
