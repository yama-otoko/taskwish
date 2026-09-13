import { expect, test } from "bun:test";
import { TW } from "@taskwish/core";

import { startScheduledActions } from "./schedule";
import type { ScheduledActions } from "./schedule";
import type { Action, NodeRegistry } from "./types";

test("runs named scheduled actions with their expression and fire time", async () => {
  const input = await new Promise<{ expression: string; at: Date }>(
    (resolve, reject) => {
      const expression = new Date(Date.now() + 1_200)
        .toISOString()
        .slice(0, 19);
      let schedules: ScheduledActions;
      const action = Object.assign(
        (value: { expression: string; at: Date }) => {
          schedules.stop();
          resolve(value);
        },
        {
          [TW.Name]: "Monitor::monitorRevenue",
          [TW.Meta]: {
            schedule: { expression, timezone: "UTC", protect: true },
          },
        },
      ) as Action;
      schedules = startScheduledActions(registry(action), reject);
      expect(schedules.names).toEqual(["Monitor::monitorRevenue"]);
    },
  );

  expect(input.expression).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(input.at).toBeInstanceOf(Date);
});

test("rejects invalid cron expressions while starting schedules", () => {
  const action = Object.assign(() => undefined, {
    [TW.Name]: "Monitor::brokenSchedule",
    [TW.Meta]: { schedule: { expression: "not a cron" } },
  }) as Action;

  expect(() => startScheduledActions(registry(action))).toThrow();
});

function registry(action: Action): NodeRegistry {
  return {
    actions: new Map([[String(action[TW.Name]), action]]),
    eventHandlers: new Map(),
  };
}
