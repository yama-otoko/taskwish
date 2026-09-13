import { Step } from "taskwish";

import { bankDataRequest } from "../shared/gocardless";
import { actor } from "./open-banking";

type BankTransaction = {
  transactionAmount?: {
    amount?: string;
    currency?: string;
  };
};

type TransactionsResponse = {
  transactions?: {
    booked?: BankTransaction[];
  };
};

export const { getAccountRevenue } = actor()
  .on("Command", "getAccountRevenue")

  .input({
    accountId: "string",
    dateFrom: "string",
    dateTo: "string",
  })

  .run(
    Step("validateRequest", function () {
      const accountId = this.input.accountId.trim();
      if (!accountId) throw new Error("accountId is required.");
      for (const [name, value] of [
        ["dateFrom", this.input.dateFrom],
        ["dateTo", this.input.dateTo],
      ] as const) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          throw new Error(`${name} must use YYYY-MM-DD format.`);
        }
      }
      if (this.input.dateFrom > this.input.dateTo) {
        throw new Error("dateFrom must not be after dateTo.");
      }
      return accountId;
    }),

    Step("calculateRevenue", async function () {
      const query = new URLSearchParams({
        date_from: this.input.dateFrom,
        date_to: this.input.dateTo,
      });
      const response = await bankDataRequest<TransactionsResponse>(
        `/accounts/${encodeURIComponent(this.validateRequest)}/transactions/?${query}`,
      );
      const credits = (response.transactions?.booked ?? [])
        .map((transaction) => transaction.transactionAmount)
        .filter(
          (amount): amount is { amount: string; currency: string } =>
            typeof amount?.amount === "string" &&
            typeof amount.currency === "string" &&
            Number(amount.amount) > 0,
        );
      const currencies = [...new Set(credits.map((credit) => credit.currency))];
      if (currencies.length > 1) {
        throw new Error("Cannot aggregate revenue across multiple currencies.");
      }
      return {
        revenue: credits.reduce((sum, credit) => sum + Number(credit.amount), 0),
        currency: currencies[0] ?? "UNKNOWN",
        transactionCount: credits.length,
      };
    }),
  )

  .meta({
    description:
      "Sum positive booked transactions for one linked bank account and date range",
    input: {
      accountId: {
        description: "GoCardless Bank Account Data account ID",
        example: "2f1dd34e-5b82-4f8f-a88c-06e927da1746",
      },
      dateFrom: { description: "Start date", example: "2026-01-01" },
      dateTo: { description: "End date", example: "2026-01-31" },
    },
  });
