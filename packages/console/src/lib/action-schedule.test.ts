import { expect, test } from "bun:test";

import { nextScheduledRun } from "./action-schedule";

test("finds the next scheduled run in the scheduler timezone", () => {
  const nextRun = nextScheduledRun(
    { expression: "0 9 1 * *", timezone: "Europe/Belgrade" },
    new Date("2026-09-13T12:00:00.000Z"),
  );

  expect(nextRun?.toISOString()).toBe("2026-10-01T07:00:00.000Z");
});

test("returns null for an invalid schedule", () => {
  expect(
    nextScheduledRun({ expression: "not a cron", timezone: "UTC" }),
  ).toBeNull();
});
