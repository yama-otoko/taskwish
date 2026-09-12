import { Step } from "taskwish";

import { bankDataRequest } from "../shared/gocardless";
import { actor } from "./open-banking";

type Requisition = {
  id: string;
  status: string | Record<string, unknown>;
  institution_id: string;
  reference: string;
  accounts: string[];
};

type AccountDetails = { account?: Record<string, unknown> } & Record<
  string,
  unknown
>;
type AccountBalances = { balances?: unknown[] };
type AccountTransactions = {
  transactions?: { booked?: unknown[]; pending?: unknown[] };
};

export const { syncBankConnection } = actor()
  .on("Command", "syncBankConnection")

  .input({
    requisitionId: "string",
    "dateFrom?": "string",
    "dateTo?": "string",
  })

  .run(
    Step("validateSyncRequest", function () {
      const requisitionId = this.input.requisitionId.trim();
      if (!requisitionId) throw new Error("requisitionId is required.");
      for (const [name, value] of [
        ["dateFrom", this.input.dateFrom],
        ["dateTo", this.input.dateTo],
      ] as const) {
        if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          throw new Error(`${name} must use YYYY-MM-DD format.`);
        }
      }
      if (
        this.input.dateFrom &&
        this.input.dateTo &&
        this.input.dateFrom > this.input.dateTo
      ) {
        throw new Error("dateFrom must not be after dateTo.");
      }
      const query = new URLSearchParams();
      if (this.input.dateFrom) query.set("date_from", this.input.dateFrom);
      if (this.input.dateTo) query.set("date_to", this.input.dateTo);
      return { requisitionId, query: query.toString() };
    }),

    Step("loadConnection", async function () {
      return bankDataRequest<Requisition>(
        `/requisitions/${encodeURIComponent(this.validateSyncRequest.requisitionId)}/`,
      );
    }),

    Step("loadAccounts", async function () {
      const suffix = this.validateSyncRequest.query
        ? `?${this.validateSyncRequest.query}`
        : "";
      return Promise.all(
        this.loadConnection.accounts.map(async (accountId) => {
          const encodedId = encodeURIComponent(accountId);
          const [details, balances, transactions] = await Promise.all([
            bankDataRequest<AccountDetails>(`/accounts/${encodedId}/details/`),
            bankDataRequest<AccountBalances>(`/accounts/${encodedId}/balances/`),
            bankDataRequest<AccountTransactions>(
              `/accounts/${encodedId}/transactions/${suffix}`,
            ),
          ]);
          return {
            id: accountId,
            details: details.account ?? details,
            balances: balances.balances ?? [],
            transactions: {
              booked: transactions.transactions?.booked ?? [],
              pending: transactions.transactions?.pending ?? [],
            },
          };
        }),
      );
    }),

    Step("buildSnapshot", function () {
      const connection = this.loadConnection;
      return {
        connection: {
          id: connection.id,
          status: connection.status,
          institutionId: connection.institution_id,
          reference: connection.reference,
        },
        accounts: this.loadAccounts,
      };
    }),
  )

  .meta({
    description:
      "Fetch linked accounts, balances, and booked and pending transactions",
    input: {
      requisitionId: {
        description: "Requisition ID returned by startBankConnection",
        example: "8126e9fb-93c9-4228-937c-68f0383c2df7",
      },
      dateFrom: {
        description: "Optional transaction start date in YYYY-MM-DD format",
        example: "2026-01-01",
      },
      dateTo: {
        description: "Optional transaction end date in YYYY-MM-DD format",
        example: "2026-01-31",
      },
    },
  });
