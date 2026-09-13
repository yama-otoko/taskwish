import { Step } from "taskwish";

import { actor } from "./revenue-monitor";

export const { revenueMonitor } = actor()
  .on("Schedule", "0 9 1 * *")
  
  .command("revenueMonitor")

  .run(
    Step("loadConfiguration", function () {
      const accountId = requiredEnvironment("REVENUE_MONITOR_ACCOUNT_ID");
      const slackChannel = requiredEnvironment("SLACK_CHANNEL_ID");
      const time = Number(process.env.REVENUE_MONITOR_TIME ?? "1");
      if (!Number.isFinite(time) || Math.abs(time) > 2) {
        throw new Error(
          "REVENUE_MONITOR_TIME must be a finite number between -2 and 2.",
        );
      }

      const firedAt = this.input.at;
      if (!(firedAt instanceof Date) || Number.isNaN(firedAt.getTime())) {
        throw new Error("The scheduler supplied an invalid fire time.");
      }
      const dateTo = new Date(
        Date.UTC(firedAt.getUTCFullYear(), firedAt.getUTCMonth(), 0),
      );
      const dateFrom = new Date(
        Date.UTC(firedAt.getUTCFullYear(), firedAt.getUTCMonth() - 1, 1),
      );

      return {
        accountId,
        slackChannel,
        time,
        dateFrom: isoDate(dateFrom),
        dateTo: isoDate(dateTo),
      };
    }),

    Step("loadRevenue", function () {
      return this.actions.openBanking.getAccountRevenue({
        accountId: this.loadConfiguration.accountId,
        dateFrom: this.loadConfiguration.dateFrom,
        dateTo: this.loadConfiguration.dateTo,
      });
    }),

    Step("expected", function () {
      return this.growth.solve({
        t: this.loadConfiguration.time,
      });
    }),

    Step("check", function () {
      const actualRevenueThousands = this.loadRevenue.revenue / 1_000;
      return {
        actualRevenueThousands,
        expectedRevenueThousands: this.expected.y,
        onTrack: actualRevenueThousands >= this.expected.y,
      };
    }),

    Step("notifySlack", async function () {
      if (this.check.onTrack) return { sent: false as const };

      const shortfall =
        this.check.expectedRevenueThousands - this.check.actualRevenueThousands;
      const message = [
        ":warning: Revenue is below the symbolic growth target.",
        `Period: ${this.loadConfiguration.dateFrom} to ${this.loadConfiguration.dateTo}`,
        `Actual: ${this.loadRevenue.currency} ${this.loadRevenue.revenue.toFixed(2)}`,
        `Expected: ${this.loadRevenue.currency} ${(this.check.expectedRevenueThousands * 1_000).toFixed(2)}`,
        `Shortfall: ${this.loadRevenue.currency} ${(shortfall * 1_000).toFixed(2)}`,
      ].join("\n");
      const response = await this.actions.slack.postMessage({
        channel: this.loadConfiguration.slackChannel,
        text: message,
      });
      return { sent: true as const, response };
    }),

    Step("report", function () {
      return {
        firedAt: this.input.at,
        accountId: this.loadConfiguration.accountId,
        period: {
          from: this.loadConfiguration.dateFrom,
          to: this.loadConfiguration.dateTo,
        },
        currency: this.loadRevenue.currency,
        transactionCount: this.loadRevenue.transactionCount,
        actualRevenue: this.loadRevenue.revenue,
        expectedRevenue: this.check.expectedRevenueThousands * 1_000,
        onTrack: this.check.onTrack,
        alertSent: this.notifySlack.sent,
      };
    }),
  )

  .meta({
    description:
      "Run the monthly Open Banking revenue check and alert Slack on a shortfall",
  });

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
