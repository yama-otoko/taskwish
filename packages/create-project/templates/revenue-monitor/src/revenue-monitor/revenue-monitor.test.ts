import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { TW } from "taskwish";

import { RevenueMonitor } from ".";

const environmentNames = [
  "REVENUE_MONITOR_ACCOUNT_ID",
  "REVENUE_MONITOR_TIME",
  "SLACK_CHANNEL_ID",
] as const;
const originalEnvironment = Object.fromEntries(
  environmentNames.map((name) => [name, process.env[name]]),
);
const scheduleInput = {
  expression: "0 9 1 * *",
  at: new Date("2026-03-01T09:00:00.000Z"),
};

beforeEach(() => {
  process.env.REVENUE_MONITOR_ACCOUNT_ID = "account-123";
  process.env.REVENUE_MONITOR_TIME = "1";
  process.env.SLACK_CHANNEL_ID = "C0123456789";
});

afterEach(() => {
  for (const name of environmentNames) {
    const value = originalEnvironment[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("exposes the named revenue monitor schedule", () => {
  expect(RevenueMonitor.revenueMonitor[TW.Name]).toBe(
    "RevenueMonitor::revenueMonitor",
  );
  expect(RevenueMonitor.revenueMonitor[TW.Meta]).toMatchObject({
    schedule: {
      expression: "0 9 1 * *",
    },
  });
});

test("alerts Slack when scheduled bank revenue is below growth", async () => {
  const getAccountRevenue = mock(async () => ({
    revenue: 1_340,
    currency: "EUR",
    transactionCount: 3,
  }));
  const postMessage = mock(
    async (message: { channel: string; text: string }) => ({
      ok: true,
      channel: message.channel,
      ts: "1712345678.000100",
    }),
  );

  const result = await RevenueMonitor.revenueMonitor
    .ctx({
      actions: {
        openBanking: { getAccountRevenue },
        slack: { postMessage },
      },
    })
    .run(scheduleInput);

  expect(getAccountRevenue).toHaveBeenCalledWith({
    accountId: "account-123",
    dateFrom: "2026-02-01",
    dateTo: "2026-02-28",
  });
  expect(result).toMatchObject({
    period: { from: "2026-02-01", to: "2026-02-28" },
    actualRevenue: 1_340,
    currency: "EUR",
    onTrack: false,
    alertSent: true,
  });
  expect(result.expectedRevenue).toBeCloseTo(1_341.468, 3);
  expect(postMessage).toHaveBeenCalledTimes(1);
  expect(postMessage.mock.calls[0]?.[0].text).toContain("Revenue is below");
});

test("does not alert when scheduled revenue meets growth", async () => {
  const getAccountRevenue = mock(async () => ({
    revenue: 1_350,
    currency: "EUR",
    transactionCount: 4,
  }));
  const postMessage = mock(
    async (_message: { channel: string; text: string }) => ({ ok: true }),
  );

  const result = await RevenueMonitor.revenueMonitor
    .ctx({
      actions: {
        openBanking: { getAccountRevenue },
        slack: { postMessage },
      },
    })
    .run(scheduleInput);

  expect(result.onTrack).toBe(true);
  expect(result.alertSent).toBe(false);
  expect(postMessage).not.toHaveBeenCalled();
});
