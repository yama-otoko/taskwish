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

test("lists institutions for a normalized country code", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/token/new/")) {
      return json({ access: "access-token", access_expires: 3600 });
    }
    return json([
      { id: "SANDBOXFINANCE_SFIN0000", name: "Sandbox Finance" },
    ]);
  }) as unknown as typeof fetch;

  const result = await OpenBanking.listBanks.run({ country: " de " });

  expect(result).toEqual([
    { id: "SANDBOXFINANCE_SFIN0000", name: "Sandbox Finance" },
  ]);
  expect(requests[1]?.url).toEndWith("/institutions/?country=DE");
  expect(new Headers(requests[1]?.init?.headers).get("authorization")).toBe(
    "Bearer access-token",
  );
});

test("creates a bank-hosted consent link", async () => {
  let requisitionBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = String(input);
    if (url.endsWith("/token/new/")) {
      return json({ access: "access-token", access_expires: 3600 });
    }
    requisitionBody = JSON.parse(String(init?.body));
    return json(
      {
        id: "req-1",
        link: "https://ob.gocardless.com/psd2/start/req-1/bank-1",
        status: "CR",
        institution_id: "bank-1",
        reference: "customer-42",
        accounts: [],
      },
      201,
    );
  }) as unknown as typeof fetch;

  const result = await OpenBanking.startBankConnection.run({
    institutionId: "bank-1",
    redirectUrl: "http://localhost:3000/banking/callback",
    reference: "customer-42",
    userLanguage: "en",
  });

  expect(result.id).toBe("req-1");
  expect(requisitionBody).toEqual({
    redirect: "http://localhost:3000/banking/callback",
    institution_id: "bank-1",
    reference: "customer-42",
    user_language: "EN",
  });
});

test("syncs details, balances, and transactions for every linked account", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/token/new/")) {
      return json({ access: "access-token", access_expires: 3600 });
    }
    if (url.endsWith("/requisitions/req-1/")) {
      return json({
        id: "req-1",
        status: "LN",
        institution_id: "bank-1",
        reference: "customer-42",
        accounts: ["account-1"],
      });
    }
    if (url.endsWith("/accounts/account-1/details/")) {
      return json({ account: { iban: "DE02120300000000202051" } });
    }
    if (url.endsWith("/accounts/account-1/balances/")) {
      return json({ balances: [{ balanceAmount: { amount: "42.00" } }] });
    }
    if (
      url.endsWith(
        "/accounts/account-1/transactions/?date_from=2026-01-01&date_to=2026-01-31",
      )
    ) {
      return json({
        transactions: {
          booked: [{ transactionId: "tx-1" }],
          pending: [{ transactionId: "tx-2" }],
        },
      });
    }
    return json({ detail: `Unexpected URL ${url}` }, 404);
  }) as unknown as typeof fetch;

  const result = await OpenBanking.syncBankConnection.run({
    requisitionId: "req-1",
    dateFrom: "2026-01-01",
    dateTo: "2026-01-31",
  });

  expect(result.connection).toEqual({
    id: "req-1",
    status: "LN",
    institutionId: "bank-1",
    reference: "customer-42",
  });
  expect(result.accounts[0]?.details).toEqual({
    iban: "DE02120300000000202051",
  });
  expect(result.accounts[0]?.transactions.booked).toEqual([
    { transactionId: "tx-1" },
  ]);
});

test("rejects unsafe redirect URLs before calling the provider", async () => {
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return json({});
  }) as unknown as typeof fetch;

  await expect(
    OpenBanking.startBankConnection.run({
      institutionId: "bank-1",
      redirectUrl: "http://example.com/callback",
    }),
  ).rejects.toThrow("redirectUrl must use HTTPS");
  expect(called).toBe(false);
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
