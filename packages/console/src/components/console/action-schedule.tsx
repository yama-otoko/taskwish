import { CalendarClock } from "lucide-react";

import { nextScheduledRun } from "../../lib/action-schedule";
import type { ConsoleAction } from "../../types";

function formatRun(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  }).format(date);
}

export function ActionSchedule({ action }: { action: ConsoleAction }) {
  if (!action.schedule) return null;

  const nextRun = nextScheduledRun(action.schedule);

  return (
    <section
      aria-label="Schedule"
      className="overflow-hidden rounded-xl border border-border bg-muted/30"
    >
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
          <CalendarClock aria-hidden="true" size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Runs automatically</p>
          <p className="text-xs text-muted-foreground">Scheduled action</p>
        </div>
      </div>

      <div className="space-y-3 px-4 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Next run
          </p>
          <p className="mt-1 text-base font-semibold leading-snug">
            {nextRun
              ? formatRun(nextRun, action.schedule.timezone)
              : "Schedule unavailable"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <code className="rounded-md border border-border bg-background px-2 py-1 font-mono text-foreground">
            {action.schedule.expression}
          </code>
          <span>{action.schedule.timezone}</span>
        </div>
      </div>
    </section>
  );
}
