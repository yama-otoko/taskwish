import { Step } from "taskwish";

import { actor } from "./paper-broker";

export const { buyPut } = actor()
  .on("Command", "buyPut")

  .input({
    ticker: "string",
    strike: "number",
    expiration: "string",
    limitPremium: "number",
    contracts: "number",
    approvalId: "string",
  })

  .run(
    Step("validateOrder", function () {
      const ticker = this.input.ticker.trim().toUpperCase();
      const approvalId = this.input.approvalId.trim();
      if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) {
        throw new Error("ticker must be a valid stock symbol.");
      }
      if (!Number.isFinite(this.input.strike) || this.input.strike <= 0) {
        throw new Error("strike must be greater than zero.");
      }
      if (
        !Number.isFinite(this.input.limitPremium) ||
        this.input.limitPremium <= 0
      ) {
        throw new Error("limitPremium must be greater than zero.");
      }
      if (!Number.isSafeInteger(this.input.contracts) || this.input.contracts <= 0) {
        throw new Error("contracts must be a positive safe integer.");
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(this.input.expiration)) {
        throw new Error("expiration must use YYYY-MM-DD.");
      }
      if (!approvalId) throw new Error("approvalId is required.");
      return { ...this.input, ticker, approvalId };
    }),

    Step("paperOrder", function () {
      return {
        orderId: `paper-${crypto.randomUUID()}`,
        mode: "paper" as const,
        status: "filled" as const,
        side: "buy" as const,
        optionType: "put" as const,
        ticker: this.validateOrder.ticker,
        strike: this.validateOrder.strike,
        expiration: this.validateOrder.expiration,
        premium: this.validateOrder.limitPremium,
        contracts: this.validateOrder.contracts,
        maxLoss:
          this.validateOrder.limitPremium * this.validateOrder.contracts * 100,
        approvalId: this.validateOrder.approvalId,
        filledAt: new Date().toISOString(),
      };
    }),
  )

  .meta({
    description:
      "Simulate an approved long put purchase without sending an order to a live broker",
    input: {
      ticker: { description: "Underlying symbol", example: "NVDA" },
      strike: { description: "Put strike price", example: 150 },
      expiration: { description: "Option expiration", example: "2027-01-15" },
      limitPremium: { description: "Maximum premium per share", example: 8 },
      contracts: { description: "Number of 100-share contracts", example: 1 },
      approvalId: { description: "Identifier for the human approval", example: "approval-1042" },
    },
  });
