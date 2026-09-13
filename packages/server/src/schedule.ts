import { TW } from "@taskwish/core";
import { Cron } from "croner";

import type { Action, NodeRegistry } from "./types";
import { isRecord } from "./utils";

export type ScheduleErrorHandler = (
  error: unknown,
  actionName: string,
) => void;

export type ScheduledActions = {
  names: readonly string[];
  stop(): void;
};

type ScheduleDefinition = {
  expression: string;
  timezone?: string;
  protect?: boolean;
};

export function startScheduledActions(
  registry: NodeRegistry,
  onError: ScheduleErrorHandler = defaultErrorHandler,
): ScheduledActions {
  const jobs: Cron[] = [];
  const names: string[] = [];

  try {
    for (const [actionName, action] of registry.actions) {
      const schedule = scheduleDefinition(action);
      if (!schedule) continue;

      const run = action.run ?? action;
      const job = new Cron(
        schedule.expression,
        {
          name: actionName,
          timezone: schedule.timezone,
          protect: schedule.protect ?? true,
          unref: true,
          catch(error) {
            onError(error, actionName);
          },
        },
        async (currentJob) => {
          await run({
            expression: schedule.expression,
            at: currentJob.currentRun() ?? new Date(),
          });
        },
      );
      jobs.push(job);
      names.push(actionName);
    }
  } catch (error) {
    for (const job of jobs) job.stop();
    throw error;
  }

  return {
    names,
    stop() {
      for (const job of jobs) job.stop();
    },
  };
}

function scheduleDefinition(action: Action): ScheduleDefinition | undefined {
  const meta = action[TW.Meta];
  if (!isRecord(meta) || !isRecord(meta.schedule)) return undefined;

  const schedule = meta.schedule;
  if (
    typeof schedule.expression !== "string" ||
    schedule.expression.trim().length === 0
  ) {
    throw new Error(
      `Scheduled action ${String(action[TW.Name])} requires a cron expression.`,
    );
  }
  if (
    schedule.timezone !== undefined &&
    typeof schedule.timezone !== "string"
  ) {
    throw new Error(
      `Scheduled action ${String(action[TW.Name])} has an invalid timezone.`,
    );
  }

  return {
    expression: schedule.expression,
    ...(schedule.timezone === undefined
      ? {}
      : { timezone: schedule.timezone }),
    ...(typeof schedule.protect === "boolean"
      ? { protect: schedule.protect }
      : {}),
  };
}

function defaultErrorHandler(error: unknown, actionName: string): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Scheduled action ${actionName} failed: ${message}`);
}
