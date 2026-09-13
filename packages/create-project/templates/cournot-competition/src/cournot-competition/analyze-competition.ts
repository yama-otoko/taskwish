import { Agent, Step } from "taskwish";

import { actor } from "./cournot-competition";

export const { analyzeCompetition } = actor()
  .on("Command", "analyzeCompetition")

  .input({
    marketDemand: "number",
    producerACost: "number",
    producerBCost: "number",
    capacity: "number",
  })

  .run(
    Agent({
      model: "anthropic/claude-sonnet-4-6",
      instructions: [
        "Explain a symbolically verified Cournot market equilibrium to an operations leader.",
        "Treat the supplied equilibrium as authoritative; do not recalculate or change it.",
        "Explain each producer's incentive, the market price, and the limits of the model.",
        "Do not turn the analysis into pricing advice or recommendations for coordination.",
      ].join(" "),
    }),

    Step("validateInputs", function () {
      for (const [name, value] of Object.entries(this.input)) {
        if (!Number.isFinite(value) || value < 0) {
          throw new Error(`${name} must be a non-negative finite number.`);
        }
      }
      if (this.input.marketDemand === 0 || this.input.capacity === 0) {
        throw new Error("marketDemand and capacity must be greater than zero.");
      }
      if (
        this.input.producerACost >= this.input.marketDemand ||
        this.input.producerBCost >= this.input.marketDemand
      ) {
        throw new Error("Each unit cost must be below marketDemand.");
      }

      return this.input;
    }),

    Step("solveEquilibrium", function () {
      return this.cournotEquilibrium.solve(this.validateInputs);
    }),

    Step("calculatePayoffs", function () {
      const equilibrium = this.solveEquilibrium;
      return {
        ...equilibrium,
        profitA:
          equilibrium.outputA *
          (equilibrium.marketPrice - equilibrium.producerACost),
        profitB:
          equilibrium.outputB *
          (equilibrium.marketPrice - equilibrium.producerBCost),
      };
    }),

    Step("explainEquilibrium", function () {
      return this.agent.generate({
        prompt: [
          "Two independent producers choose output at the same time.",
          "The inverse market demand is price = marketDemand - outputA - outputB.",
          "Each producer maximizes (price - its unit cost) * its output, subject to capacity.",
          `Verified Nash equilibrium: ${JSON.stringify(this.calculatePayoffs)}.`,
          "Explain why neither producer benefits from changing output alone and name the practical assumptions.",
        ].join("\n"),
        abortSignal: AbortSignal.timeout(60_000),
      });
    }),

    Step("result", function () {
      return {
        equilibrium: this.calculatePayoffs,
        explanation: this.explainEquilibrium,
      };
    }),
  )

  .meta({
    description:
      "Find a capacity-constrained Cournot equilibrium and explain the verified result with Claude",
    input: {
      marketDemand: { example: 120 },
      producerACost: { example: 18 },
      producerBCost: { example: 24 },
      capacity: { example: 60 },
    },
  });
