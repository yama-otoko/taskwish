import { Step } from "taskwish";

import { actor } from "./ai-bubble-hedge";

export const { evaluateAiBubbleHedge } = actor()
  .on("Command", "evaluateAiBubbleHedge")

  .input({
    ticker: "string",
    spot: "number",
    strike: "number",
    expiration: "string",
    limitPremium: "number",
    contracts: "number",
    accountEquity: "number",
    maxRiskPercent: "number",
    "minimumBurstProbability?": "number",
    "minimumJevProbability?": "number",
    "marketSlug?": "string",
    "approvalId?": "string",
  })

  .run(
    Step("validateProposal", function () {
      const ticker = this.input.ticker.trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) {
        throw new Error("ticker must be a valid stock symbol.");
      }
      for (const [name, value] of Object.entries({
        spot: this.input.spot,
        strike: this.input.strike,
        limitPremium: this.input.limitPremium,
        accountEquity: this.input.accountEquity,
      })) {
        if (!Number.isFinite(value) || value <= 0) {
          throw new Error(`${name} must be greater than zero.`);
        }
      }
      if (!Number.isSafeInteger(this.input.contracts) || this.input.contracts <= 0) {
        throw new Error("contracts must be a positive safe integer.");
      }
      if (
        !Number.isFinite(this.input.maxRiskPercent) ||
        this.input.maxRiskPercent <= 0 ||
        this.input.maxRiskPercent > 100
      ) {
        throw new Error("maxRiskPercent must be between zero and 100.");
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(this.input.expiration)) {
        throw new Error("expiration must use YYYY-MM-DD.");
      }
      const minimumBurstProbability = probability(
        this.input.minimumBurstProbability ?? 0.2,
        "minimumBurstProbability",
      );
      const minimumJevProbability = probability(
        this.input.minimumJevProbability ?? 0.8,
        "minimumJevProbability",
      );
      return {
        ...this.input,
        ticker,
        minimumBurstProbability,
        minimumJevProbability,
        approvalId: this.input.approvalId?.trim() || "",
        maxLoss: this.input.limitPremium * this.input.contracts * 100,
        riskBudget:
          this.input.accountEquity * (this.input.maxRiskPercent / 100),
      };
    }),

    Step("loadPolymarketSignal", function () {
      return this.actions.polymarket.getAiBubbleMarket({
        marketSlug: this.validateProposal.marketSlug,
      });
    }),

    Step("judgeEvidence", function () {
      const market = this.loadPolymarketSignal;
      return this.actions.hedgeJudge.evaluateHedgeEvidence({
        ticker: this.validateProposal.ticker,
        question: market.question,
        marketSlug: market.slug,
        yesProbability: market.yesProbability,
        active: market.active,
        closed: market.closed,
        liquidity: market.liquidity,
        volume: market.volume,
        marketEndDate: market.endDate,
        optionExpiration: this.validateProposal.expiration,
      });
    }),

    Step("symbolicDecision", function () {
      return this.hedgePolicy.solve({
        marketProbability: this.loadPolymarketSignal.yesProbability,
        minimumMarketProbability:
          this.validateProposal.minimumBurstProbability,
        jevSupportProbability: this.judgeEvidence.supportProbability,
        minimumJevProbability: this.validateProposal.minimumJevProbability,
        horizonMatchProbability: this.judgeEvidence.horizonMatchProbability,
        minimumHorizonProbability: 0.7,
        dataQualityConfidence: this.judgeEvidence.dataQualityConfidence,
        minimumDataQualityConfidence: 0.8,
        strike: this.validateProposal.strike,
        spot: this.validateProposal.spot,
        maxLoss: this.validateProposal.maxLoss,
        riskBudget: this.validateProposal.riskBudget,
        marketActive:
          this.loadPolymarketSignal.active &&
          !this.loadPolymarketSignal.closed,
        dataQualityReliable: this.judgeEvidence.dataQuality === "reliable",
      });
    }),

    Step("executePaperOrder", function () {
      if (!this.symbolicDecision.eligible) {
        return { status: "rejectedByPolicy" as const };
      }
      if (!this.validateProposal.approvalId) {
        return { status: "awaitingApproval" as const };
      }
      return this.actions.paperBroker.buyPut({
        ticker: this.validateProposal.ticker,
        strike: this.validateProposal.strike,
        expiration: this.validateProposal.expiration,
        limitPremium: this.validateProposal.limitPremium,
        contracts: this.validateProposal.contracts,
        approvalId: this.validateProposal.approvalId,
      });
    }),

    Step("report", function () {
      return {
        ticker: this.validateProposal.ticker,
        market: this.loadPolymarketSignal,
        jev: this.judgeEvidence,
        risk: {
          maxLoss: this.validateProposal.maxLoss,
          budget: this.validateProposal.riskBudget,
        },
        symbolicCalculation: "sat" as const,
        eligible: this.symbolicDecision.eligible,
        execution: this.executePaperOrder,
        disclaimer:
          "Educational paper trade only. A prediction-market price is not a sufficient stock forecast or investment recommendation.",
      };
    }),
  )

  .meta({
    description:
      "Combine Polymarket's AI downturn probability, a JEV evidence judgment, and symbolic risk rules before an approved paper put purchase",
    input: {
      ticker: { description: "Underlying stock or ETF symbol", example: "NVDA" },
      spot: { description: "Current underlying price", example: 180 },
      strike: { description: "Proposed put strike", example: 160 },
      expiration: { description: "Proposed put expiration", example: "2027-01-15" },
      limitPremium: { description: "Maximum premium per share", example: 6 },
      contracts: { description: "Number of 100-share put contracts", example: 1 },
      accountEquity: { description: "Paper account equity", example: 100000 },
      maxRiskPercent: { description: "Maximum premium at risk as percent of equity", example: 1 },
      minimumBurstProbability: { description: "Minimum Polymarket YES probability", example: 0.2 },
      minimumJevProbability: { description: "Minimum JEV support probability", example: 0.8 },
      marketSlug: { description: "Optional Polymarket market slug override" },
      approvalId: { description: "Human approval identifier; omit to stop before execution", example: "approval-1042" },
    },
  });

function probability(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be between zero and one.`);
  }
  return value;
}
