import { Command as CommandPrimitive } from "cmdk";
import { Copy, ArrowUpRight } from "lucide-react";

import ActorArtwork from "../console/actor-artwork";
import { cn } from "../../lib/utils";
import {
  actionDescription,
  actionTitle,
  getActionValue,
} from "../../lib/command-actions";
import type { ConsoleAction } from "../../types";

function ActionIcon({ action }: { action: ConsoleAction }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors group-hover:bg-accent"
    >
      {action.source === "http" ? (
        <Copy size={18} />
      ) : (
        <ArrowUpRight size={18} />
      )}
    </span>
  );
}

export function ActionCommandItem({
  action,
  onSelect,
}: {
  action: ConsoleAction;
  onSelect: (action: ConsoleAction) => void;
}) {
  return (
    <CommandPrimitive.Item
      value={getActionValue(action)}
      keywords={[
        actionTitle(action),
        action.actor,
        actionDescription(action),
        action.source,
      ]}
      onSelect={() => onSelect(action)}
      className={cn(
        "group relative flex h-full min-h-[130px] w-full cursor-pointer flex-col rounded-2xl border border-border bg-action/50 p-4 text-left transition-[background-color,border-color,box-shadow] duration-100 hover:bg-action data-[selected=true]:border-transparent data-[selected=true]:ring-2 data-[selected=true]:ring-landing-primary md:min-h-[150px]",
        "outline-none",
      )}
    >
      <div className="flex flex-col gap-2">
        <span className="break-words font-semibold leading-tight text-foreground sm:text-lg">
          {actionTitle(action)}
        </span>
      </div>

      <div className=" mt-auto flex min-w-0 items-end justify-between gap-2 pt-3">
        <span className="-ml-2 -mt-2 flex min-w-0 flex-col items-start gap-0.5 truncate text-xs font-semibold">
          <ActorArtwork
            name={action.actor}
            className="h-[60px] w-[60px] shrink-0"
          />
          <span className="ml-2">{action.actor}</span>
        </span>
        <ActionIcon action={action} />
      </div>
    </CommandPrimitive.Item>
  );
}
