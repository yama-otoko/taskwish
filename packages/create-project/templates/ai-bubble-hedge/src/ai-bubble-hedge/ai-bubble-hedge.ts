import { Actor } from "taskwish";
import { Bool, Model, Real } from "@taskwish/symbolic";

import { HedgeJudge } from "../hedge-judge";
import { PaperBroker } from "../paper-broker";
import { Polymarket } from "../polymarket";

export const { actor } = Actor("AiBubbleHedge")
  .use(Polymarket, HedgeJudge, PaperBroker)

  .scope(
    Real(
      "marketProbability",
      "minimumMarketProbability",
      "jevSupportProbability",
      "minimumJevProbability",
      "horizonMatchProbability",
      "minimumHorizonProbability",
      "dataQualityConfidence",
      "minimumDataQualityConfidence",
      "strike",
      "spot",
      "maxLoss",
      "riskBudget",
    ),

    Bool("marketActive", "dataQualityReliable", "eligible"),

    Model(
      "hedgePolicy",
      ({
        eligible,
        marketActive,
        dataQualityReliable,
        marketProbability,
        minimumMarketProbability,
        jevSupportProbability,
        minimumJevProbability,
        horizonMatchProbability,
        minimumHorizonProbability,
        dataQualityConfidence,
        minimumDataQualityConfidence,
        strike,
        spot,
        maxLoss,
        riskBudget,
      }) =>
        eligible ==
        (marketActive &&
          dataQualityReliable &&
          marketProbability >= minimumMarketProbability &&
          jevSupportProbability >= minimumJevProbability &&
          horizonMatchProbability >= minimumHorizonProbability &&
          dataQualityConfidence >= minimumDataQualityConfidence &&
          strike <= spot &&
          maxLoss <= riskBudget),
    ),
  );
