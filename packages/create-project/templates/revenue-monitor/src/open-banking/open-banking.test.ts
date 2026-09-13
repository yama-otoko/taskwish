import { afterEach, beforeEach, expect, test } from "bun:test";

import { OpenBanking } from ".";
import { resetBankDataTokenCache } from "../shared/gocardless";

const originalFetch = globalThis.fetch;
const originalSecretId = process.env.GOCARDLESS_BANK_SECRET_ID;
const originalSecretKey = process.env.GOCARDLESS_BANK_SECRET_KEY;

beforeEach(() => {
  process.env.GOCARDLESS_BANK_SECRET_ID = "test-secret-id";
  process.env.GOCARDLESS_BANK_SECRET_KEY = "test-secret-key";
  resetBankDataTokenCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalSecretId === undefined)
    delete process.env.GOCARDLESS_BANK_SECRET_ID;
  else process.env.GOCARDLESS_BANK_SECRET_ID = originalSecretId;
  if (originalSecretKey === undefined)
    delete process.env.GOCARDLESS_BANK_SECRET_KEY;
  else process.env.GOCARDLESS_BANK_SECRET_KEY = originalSecretKey;
  resetBankDataTokenCache();
});

test("sums positive booked bank transactions as revenue", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith("/token/new/")) {
      return json({ access: "access-token", access_expires: 3600 });
    }
    return json({
      transactions: {
        booked: [
          { transactionAmount: { amount: "900.25", currency: "EUR" } },
          { transactionAmount: { amount: "440.50", currency: "EUR" } },
          { transactionAmount: { amount: "-75.00", currency: "EUR" } },
        ],
      },
    });
  }) as unknown as typeof fetch;

  const result = await OpenBanking.getAccountRevenue.run({
    accountId: "account-123",
    dateFrom: "2026-01-01",
    dateTo: "2026-01-31",
  });

  expect(result).toEqual({
    revenue: 1_340.75,
    currency: "EUR",
    transactionCount: 2,
  });
  expect(urls[1]).toEndWith(
    "/accounts/account-123/transactions/?date_from=2026-01-01&date_to=2026-01-31",
  );
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
