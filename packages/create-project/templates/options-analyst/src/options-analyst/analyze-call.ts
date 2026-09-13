import { Agent, Step } from "taskwish";

import {
  evaluateDistributionFunctions,
  evaluateInputFunctions,
} from "../shared/greeks";
import { actor } from "./options-analyst";

const analystInstructions = [
  "Explain a deterministic European call-option risk snapshot for education.",
  "Treat every supplied number as authoritative and never recalculate or alter it.",
  "Explain Delta, Gamma, daily Theta, Vega per volatility point, and Rho per rate point in plain language.",
  "Discuss the supplied delta-gamma spot scenario and identify assumptions or model risk.",
  "Do not recommend buying, selling, sizing, or timing a trade. Do not claim the Greeks predict realized P&L.",
].join(" ");

export const { analyzeCall } = actor()
  .on("Command", "analyzeCall")

  .input({
    spot: "number",
    strike: "number",
    rate: "number",
    volatility: "number",
    daysToExpiry: "number",
    "contracts?": "number",
    "spotMovePercent?": "number",
    "question?": "string",
  })

  .run(
    Step("validateInputs", function () {
      const { spot, strike, rate, volatility, daysToExpiry } = this.input;
      for (const [name, value] of Object.entries({
        spot,
        strike,
        rate,
        volatility,
        daysToExpiry,
      })) {
        if (!Number.isFinite(value)) {
          throw new Error(`${name} must be finite.`);
        }
      }
      if (spot <= 0 || strike <= 0) {
        throw new Error("spot and strike must be greater than zero.");
      }
      if (volatility <= 0) {
        throw new Error("volatility must be greater than zero.");
      }
      if (daysToExpiry <= 0) {
        throw new Error("daysToExpiry must be greater than zero.");
      }
      if (
        spot > 1_000_000_000_000 ||
        strike > 1_000_000_000_000 ||
        rate < -1 ||
        rate > 10 ||
        volatility > 10 ||
        daysToExpiry > 36_500
      ) {
        throw new Error("Inputs are outside the supported educational range.");
      }
      const contracts = this.input.contracts ?? 1;
      if (
        !Number.isSafeInteger(contracts) ||
        contracts <= 0 ||
        contracts > 1_000_000
      ) {
        throw new Error(
          "contracts must be a positive safe integer no greater than 1,000,000.",
        );
      }
      const spotMovePercent = this.input.spotMovePercent ?? 1;
      if (
        !Number.isFinite(spotMovePercent) ||
        Math.abs(spotMovePercent) > 100
      ) {
        throw new Error("spotMovePercent must be between -100 and 100.");
      }
      const question =
        this.input.question?.trim() || "Explain the main risks.";
      if (question.length > 2_000) {
        throw new Error("question must be at most 2,000 characters.");
      }
      return {
        spot,
        strike,
        rate,
        volatility,
        daysToExpiry,
        contracts,
        spotMovePercent,
        question,
      };
    }),

    Agent({
      model: "openai/gpt-6-astra",
      instructions: analystInstructions,
    }),

    Step("evaluateInputFunctions", function () {
      return evaluateInputFunctions({
        spot: this.validateInputs.spot,
        strike: this.validateInputs.strike,
        rate: this.validateInputs.rate,
        volatility: this.validateInputs.volatility,
        daysToExpiry: this.validateInputs.daysToExpiry,
      });
    }),

    Step("solveDTerms", function () {
      return this.dTermsFormula.solve({
        S: this.validateInputs.spot,
        K: this.validateInputs.strike,
        r: this.validateInputs.rate,
        sigma: this.validateInputs.volatility,
        tau: this.evaluateInputFunctions.tau,
        sqrtTau: this.evaluateInputFunctions.sqrtTau,
        logMoneyness: this.evaluateInputFunctions.logMoneyness,
      });
    }),

    Step("evaluateDistributionFunctions", function () {
      return evaluateDistributionFunctions({
        rate: this.validateInputs.rate,
        tau: this.evaluateInputFunctions.tau,
        d1: this.solveDTerms.d1,
        d2: this.solveDTerms.d2,
      });
    }),

    Step("solveGreeks", function () {
      return this.greeksFormula.solve({
        S: this.validateInputs.spot,
        K: this.validateInputs.strike,
        r: this.validateInputs.rate,
        sigma: this.validateInputs.volatility,
        tau: this.evaluateInputFunctions.tau,
        sqrtTau: this.evaluateInputFunctions.sqrtTau,
        logMoneyness: this.evaluateInputFunctions.logMoneyness,
        discount: this.evaluateDistributionFunctions.discount,
        densityD1: this.evaluateDistributionFunctions.densityD1,
        cdfD1: this.evaluateDistributionFunctions.cdfD1,
        cdfD2: this.evaluateDistributionFunctions.cdfD2,
        d1: this.solveDTerms.d1,
        d2: this.solveDTerms.d2,
      });
    }),

    Step("riskSnapshot", function () {
      const value = this.solveGreeks;
      const shares = 100 * this.validateInputs.contracts;
      const spotMove =
        this.validateInputs.spot *
        (this.validateInputs.spotMovePercent / 100);
      return {
        assumptions: {
          style: "European call",
          dividends: "none",
          compounding: "continuous",
          daysPerYear: 365,
        },
        inputs: {
          spot: this.validateInputs.spot,
          strike: this.validateInputs.strike,
          rate: this.validateInputs.rate,
          volatility: this.validateInputs.volatility,
          daysToExpiry: this.validateInputs.daysToExpiry,
          contracts: this.validateInputs.contracts,
        },
        perShare: {
          theoreticalPrice: value.price,
          delta: value.delta,
          gamma: value.gamma,
          thetaPerDay: value.theta / 365,
          vegaPerPoint: value.vega / 100,
          rhoPerPoint: value.rho / 100,
        },
        position: {
          deltaEquivalentShares: value.delta * shares,
          dailyTheta: (value.theta / 365) * shares,
          vegaPerPoint: (value.vega / 100) * shares,
          rhoPerPoint: (value.rho / 100) * shares,
        },
        scenario: {
          spotMovePercent: this.validateInputs.spotMovePercent,
          spotMove,
          deltaGammaEstimatedChange:
            (value.delta * spotMove +
              0.5 * value.gamma * spotMove * spotMove) *
            shares,
        },
        symbolicCalculation: "sat" as const,
      };
    }),

    Step("analysis", function () {
      return this.agent.generate({
        prompt: [
          `User question: ${this.validateInputs.question}`,
          `Verified risk snapshot: ${JSON.stringify(this.riskSnapshot)}`,
          "Write a concise risk memo. Clearly label theoretical estimates and limitations.",
        ].join("\n\n"),
        abortSignal: AbortSignal.timeout(60_000),
      });
    }),

    Step("report", function () {
      return {
        snapshot: this.riskSnapshot,
        analysis: this.analysis,
      };
    }),
  )

  .meta({
    description:
      "Calculate and symbolically verify European call Greeks, then explain the risk snapshot with OpenAI",
    input: {
      spot: { description: "Current underlying price", example: 100 },
      strike: { description: "Option strike price", example: 100 },
      rate: {
        description: "Annual risk-free rate as a decimal",
        example: 0.05,
      },
      volatility: {
        description: "Annualized volatility as a decimal",
        example: 0.2,
      },
      daysToExpiry: { description: "Calendar days to expiry", example: 365 },
      contracts: {
        description: "Number of long call contracts",
        example: 1,
      },
      spotMovePercent: {
        description: "Spot shock used for delta-gamma approximation",
        example: 1,
      },
      question: {
        description: "Optional risk question for the analyst",
        example: "What dominates this position's near-term risk?",
      },
    },
  });
