import { Cron } from "croner";

import type { ConsoleAction } from "../types";

export function nextScheduledRun(
  schedule: NonNullable<ConsoleAction["schedule"]>,
  from = new Date(),
): Date | null {
  try {
    return (
      new Cron(schedule.expression, {
        paused: true,
        timezone: schedule.timezone,
      }).nextRun(from) ?? null
    );
  } catch {
    return null;
  }
}
