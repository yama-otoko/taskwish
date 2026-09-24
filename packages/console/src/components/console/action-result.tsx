import {
  ArrowUpRightIcon,
  CheckIcon,
  CopyIcon,
  FileTextIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";

import { cn } from "../../lib/utils";
import { sentenceFromIdentifier } from "../../lib/console-text";
import { Button } from "../ui/button";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "../ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "../ai-elements/reasoning";
import {
  streamActionResponse,
  formatActionResultBody,
  type ActionRunEvent,
  type ActionRunResult,
} from "../../lib/command-form";
import type { ConsoleAction, ConsoleConfig } from "../../types";

type StateActionDescriptor = {
  alias: string;
  action: string;
  input: Record<string, string>;
  visible?: Record<string, unknown>;
};

type StateBubblePayload = {
  path: string;
  value: unknown;
  previous?: unknown;
  columns?: string[];
  actions?: Record<string, StateActionDescriptor>;
};

type RunBubble = {
  id: string;
  type:
    | "yield"
    | "agent"
    | "thought"
    | "tool"
    | "plan"
    | "activity"
    | "wind"
    | "result"
    | "error"
    | "state"
    | "state-change";
  body: string;
  title?: string;
  state?: StateBubblePayload;
  acpId?: string;
};

type AppendedStateActionBubble =
  | {
      id: string;
      type: "action";
      name: string;
      action: string;
      input: Record<string, unknown>;
      actor?: string;
    }
  | {
      id: string;
      type: "state" | "state-change";
      state: StateBubblePayload;
      actor?: string;
    }
  | {
      id: string;
      type: "error";
      body: string;
      actor?: string;
    };

function ScrollToAppendedStateActions({ count }: { count: number }) {
  const { scrollToBottom } = useStickToBottomContext();
  const previousCount = useRef(count);

  useEffect(() => {
    if (count > previousCount.current) void scrollToBottom();
    previousCount.current = count;
  }, [count, scrollToBottom]);

  return null;
}

const WIND_TITLE_KEY = ">>";
const WIND_SIGNAL_KEY = "->";
const WIND_SESSION_KEY = "sessionId";

type TraceTreeNode = {
  name: string;
  entries: TraceTreeEntry[];
};

type TraceTreeEntry =
  | { type: "node"; node: TraceTreeNode }
  | { type: "line"; text: string };

function eventBody(value: unknown): string {
  return typeof value === "string"
    ? value
    : JSON.stringify(value, null, 2) ?? String(value);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function acpUpdate(event: ActionRunEvent): Record<string, unknown> | null {
  return recordValue(recordValue(event.data)?.update);
}

function acpText(event: ActionRunEvent): string {
  const content = recordValue(acpUpdate(event)?.content);
  return typeof content?.text === "string" ? content.text : "";
}

function acpDisplayName(message: string | undefined): string {
  return sentenceFromIdentifier(message?.replace(/^ACP::/, "") ?? "Agent");
}

function acpActivityBody(event: ActionRunEvent): string {
  const update = acpUpdate(event);
  if (event.message === "ACP::UsageUpdate" && update) {
    const used = update.used;
    return typeof used === "number" ? `${used.toLocaleString()} tokens` : "";
  }
  if (event.message === "ACP::Stop") {
    const stopReason = recordValue(event.data)?.stopReason;
    return typeof stopReason === "string"
      ? sentenceFromIdentifier(stopReason)
      : "Completed";
  }
  return update ? eventBody(update) : eventBody(event.data);
}

function stateBubblePayload(value: unknown): StateBubblePayload | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof (value as Record<string, unknown>).path !== "string" ||
    !("value" in value)
  ) {
    return null;
  }
  return value as StateBubblePayload;
}

function scopedBubbleLabel(actor: string | undefined, label: string): string {
  return actor ? `${actor} - ${label}` : label;
}

function stateChangeLabel(path: string, actor?: string): string {
  const separator = path.indexOf("::");
  if (separator < 0) return scopedBubbleLabel(actor, `${path} changed`);

  return scopedBubbleLabel(
    path.slice(0, separator),
    `${path.slice(separator + 2)} changed`
  );
}

function consoleValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => consoleValue(item)).join(", ")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return `{ ${entries
      .map(([key, item]) => `${JSON.stringify(key)}: ${consoleValue(item)}`)
      .join(", ")} }`;
  }
  return String(value);
}

function traceValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "";
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => traceValue(item)).join(", ")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return `{ ${entries
      .map(([key, item]) => `${traceKey(key)}: ${traceValue(item)}`)
      .join(", ")} }`;
  }
  return String(value);
}

function traceErrorValue(value: unknown): string {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const error = value as Record<string, unknown>;
    if (typeof error.content === "string") return error.content;
    if (typeof error.message === "string") return error.message;
  }

  return traceValue(value);
}

function errorBubbleBody(value: unknown): string {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "error" in value
  ) {
    return traceErrorValue((value as Record<string, unknown>).error);
  }

  return traceErrorValue(value);
}

function traceKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

function isEmptyTraceValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && !value.trim()) ||
    (Array.isArray(value) && !value.length) ||
    (typeof value === "object" &&
      !Array.isArray(value) &&
      !Object.keys(value).length)
  );
}

function windLogBody(event: ActionRunEvent): string {
  if (event.data === null || typeof event.data !== "object") {
    return eventBody(event.data);
  }

  if (!Array.isArray(event.data) && WIND_TITLE_KEY in event.data) {
    const { [WIND_TITLE_KEY]: _title, ...body } = event.data as Record<
      string,
      unknown
    >;
    if (!Object.keys(body).length) return "";
    return consoleValue(body);
  }

  return consoleValue(event.data);
}

function windLogTitle(event: ActionRunEvent): string {
  if (
    event.data !== null &&
    typeof event.data === "object" &&
    !Array.isArray(event.data) &&
    WIND_TITLE_KEY in event.data
  ) {
    const title = (event.data as Record<string, unknown>)[WIND_TITLE_KEY];
    return typeof title === "string" ? title : String(title);
  }

  return "Trace";
}

function isWindTreeEvent(
  event: ActionRunEvent
): event is ActionRunEvent & { data: Record<string, unknown> } {
  return (
    event.type === "wind" &&
    event.data !== null &&
    typeof event.data === "object" &&
    !Array.isArray(event.data) &&
    (typeof (event.data as Record<string, unknown>)[WIND_TITLE_KEY] ===
      "string" ||
      typeof (event.data as Record<string, unknown>)[WIND_SIGNAL_KEY] ===
        "string")
  );
}

function tracePath(title: string): string[] {
  const localTitle = title.includes("::")
    ? title.slice(title.indexOf("::") + 2)
    : title;
  return localTitle.split(".").filter(Boolean);
}

function tracePayloadLine(data: Record<string, unknown>): string | null {
  const body = Object.fromEntries(
    Object.entries(data).filter(
      ([key, value]) =>
        key !== WIND_TITLE_KEY &&
        key !== WIND_SIGNAL_KEY &&
        key !== WIND_SESSION_KEY &&
        value !== undefined
    )
  );
  const keys = Object.keys(body);

  if (!keys.length) return null;

  if ("log" in body) {
    const { log, ...rest } = body;
    const suffix = Object.keys(rest).length ? ` ${traceValue(rest)}` : "";
    return `${traceValue(log)}${suffix}`;
  }

  if ("message" in body) {
    const { message, ...rest } = body;
    const suffix = Object.keys(rest).length ? ` ${traceValue(rest)}` : "";
    return `${traceValue(message)}${suffix}`;
  }

  if (keys.length === 1 && "input" in body) {
    return isEmptyTraceValue(body.input) ? null : traceValue(body.input);
  }

  if (keys.length === 1 && "result" in body) {
    return isEmptyTraceValue(body.result)
      ? "✓"
      : `✓ ${traceValue(body.result)}`;
  }

  if (keys.length === 1 && "error" in body) {
    return `× ${traceErrorValue(body.error)}`;
  }

  return traceValue(body);
}

export function signalPayloadLine(data: Record<string, unknown>): string {
  const title = String(data[WIND_SIGNAL_KEY]);
  const signalName = tracePath(title).join(".") || title;
  const body = Object.fromEntries(
    Object.entries(data).filter(
      ([key, value]) =>
        key !== WIND_SIGNAL_KEY &&
        key !== WIND_SESSION_KEY &&
        value !== undefined
    )
  );
  const payload =
    Object.keys(body).length === 1 && "data" in body ? body.data : body;
  const suffix = isEmptyTraceValue(payload) ? "" : ` ${traceValue(payload)}`;

  return `-> ${signalName}${suffix}`;
}

function ensureTraceNode(
  entries: TraceTreeEntry[],
  name: string
): TraceTreeNode {
  const existing = entries.find(
    (entry) => entry.type === "node" && entry.node.name === name
  );
  if (existing?.type === "node") return existing.node;

  const node: TraceTreeNode = { name, entries: [] };
  entries.push({ type: "node", node });
  return node;
}

function buildTraceTree(events: ActionRunEvent[]): string {
  const roots: TraceTreeEntry[] = [];
  let currentRoot: TraceTreeNode | null = null;

  for (const event of events) {
    if (!isWindTreeEvent(event)) continue;

    if (typeof event.data[WIND_SIGNAL_KEY] === "string") {
      const node =
        currentRoot ??
        ensureTraceNode(
          roots,
          tracePath(String(event.data[WIND_SIGNAL_KEY]))[0] ?? "Trace"
        );
      node.entries.push({ type: "line", text: signalPayloadLine(event.data) });
      continue;
    }

    const title = String(event.data[WIND_TITLE_KEY]);
    const path = tracePath(title);
    const rootName = path[0] ?? "Trace";
    let node = ensureTraceNode(roots, rootName);
    currentRoot = node;

    for (const segment of path.slice(1)) {
      node = ensureTraceNode(node.entries, segment);
    }

    const line = tracePayloadLine(event.data);
    if (line) node.entries.push({ type: "line", text: line });
  }

  const lines: string[] = [];
  for (const root of roots) {
    if (root.type !== "node") continue;
    lines.push(root.node.name);
    renderTraceEntries(root.node.entries, "", lines);
  }

  return lines.join("\n");
}

function renderTraceEntries(
  entries: TraceTreeEntry[],
  prefix: string,
  lines: string[]
) {
  entries.forEach((entry, index) => {
    const isLast = index === entries.length - 1;
    const branch = isLast ? "└─" : "├─";
    const childPrefix = `${prefix}${isLast ? "   " : "│  "}`;

    if (entry.type === "line") {
      lines.push(`${prefix}${branch} ${entry.text}`);
      return;
    }

    lines.push(`${prefix}${branch} ${entry.node.name}`);
    renderTraceEntries(entry.node.entries, childPrefix, lines);
  });
}

function windEventsBody(events: ActionRunEvent[]): string {
  if (events.every(isWindTreeEvent)) return buildTraceTree(events);

  return events
    .map((event) => {
      const body = windLogBody(event);
      return body ? `${windLogTitle(event)}\n${body}` : windLogTitle(event);
    })
    .join("\n");
}

function isTraceErrorLine(line: string): boolean {
  return /(?:^| )×(?: |$)/.test(line);
}

export function TraceLine({ line }: { line: string }) {
  const parts = line.split(/(├─|└─|│|✓|->)/g).filter(Boolean);

  return (
    <span className={cn("block", isTraceErrorLine(line) && "text-destructive")}>
      {parts.map((part, index) => {
        if (part === "├─" || part === "└─" || part === "│") {
          return (
            <span
              key={`${part}-${index}`}
              className="text-muted-foreground opacity-50"
            >
              {part}
            </span>
          );
        }

        if (part === "✓") {
          return (
            <span key={`${part}-${index}`} className="font-bold">
              {part}
            </span>
          );
        }

        if (part === "->") {
          return (
            <span key={`${part}-${index}`} className="font-bold">
              {part}
            </span>
          );
        }

        return part;
      })}
    </span>
  );
}

export function buildRunBubbles(
  result: ActionRunResult | null,
  showLogs: boolean
): RunBubble[] {
  if (!result) return [];

  if (!result.events) {
    return [
      {
        id: "result",
        type: result.ok ? "result" : "error",
        body: formatActionResultBody(result.body),
      },
    ];
  }

  const bubbles: RunBubble[] = [];
  let currentYield = "";
  const windEvents: ActionRunEvent[] = [];
  const toolStates = new Map<string, Record<string, unknown>>();
  const toolBubbles = new Map<string, RunBubble>();
  let windBubble: RunBubble | null = null;
  let hasFinalEvent = false;
  const hasYieldEvents = result.events.some((event) => event.type === "yield");

  const flushYield = (index: number) => {
    if (!currentYield) return;
    bubbles.push({
      id: `yield-${index}`,
      type: "yield",
      body: currentYield,
    });
    currentYield = "";
  };

  const updateWindEvents = () => {
    if (!showLogs) return;
    if (!windBubble) {
      windBubble = {
        id: "wind-trace",
        type: "wind",
        body: "",
        title: "Trace",
      };
      bubbles.push(windBubble);
    }
    windBubble.body = windEventsBody(windEvents);
  };

  result.events.forEach((event, index) => {
    if (event.type === "yield") {
      currentYield += eventBody(event.data);
      return;
    }

    if (event.type === "wind") {
      flushYield(index);
      windEvents.push(event);
      updateWindEvents();
      return;
    }

    if (event.type === "acp") {
      const update = acpUpdate(event);
      const messageId =
        typeof update?.messageId === "string" ? update.messageId : undefined;

      if (event.message === "ACP::UserMessageChunk") {
        // The command/chat input is already rendered as the user message.
        return;
      }

      if (event.message === "ACP::AgentMessageChunk") {
        // Streaming actions already render their TW::Stream text. ACP remains
        // the source for awaited generate() calls that do not yield text.
        if (hasYieldEvents) return;
        flushYield(index);
        const text = acpText(event);
        if (!text) return;
        const previous = bubbles.at(-1);
        if (
          previous?.type === "agent" &&
          (!messageId || previous.acpId === messageId)
        ) {
          previous.body += text;
        } else {
          bubbles.push({
            id: `acp-agent-${index}`,
            type: "agent",
            body: text,
            acpId: messageId,
          });
        }
        return;
      }

      if (event.message === "ACP::AgentThoughtChunk") {
        flushYield(index);
        const text = acpText(event);
        if (!text) return;
        const previous = bubbles.at(-1);
        if (
          previous?.type === "thought" &&
          (!messageId || previous.acpId === messageId)
        ) {
          previous.body += text;
        } else {
          bubbles.push({
            id: `acp-thought-${index}`,
            type: "thought",
            title: "Thinking",
            body: text,
            acpId: messageId,
          });
        }
        return;
      }

      if (
        event.message === "ACP::ToolCall" ||
        event.message === "ACP::ToolCallUpdate"
      ) {
        flushYield(index);
        if (!update) return;
        const toolCallId = String(update.toolCallId ?? `tool-${index}`);
        const state = { ...toolStates.get(toolCallId), ...update };
        toolStates.set(toolCallId, state);
        const title = String(state.title ?? state.name ?? "Tool");
        const details = Object.fromEntries(
          Object.entries(state).filter(
            ([key]) =>
              ![
                "sessionUpdate",
                "toolCallId",
                "title",
                "name",
                "_meta",
              ].includes(key)
          )
        );
        const body = eventBody(details);
        const existing = toolBubbles.get(toolCallId);
        if (existing) {
          existing.title = title;
          existing.body = body;
        } else {
          const bubble: RunBubble = {
            id: `acp-tool-${toolCallId}`,
            type: "tool",
            title,
            body,
            acpId: toolCallId,
          };
          toolBubbles.set(toolCallId, bubble);
          bubbles.push(bubble);
        }
        return;
      }

      if (
        event.message === "ACP::Plan" ||
        event.message === "ACP::PlanUpdate" ||
        event.message === "ACP::PlanRemoved"
      ) {
        flushYield(index);
        bubbles.push({
          id: `acp-plan-${index}`,
          type: "plan",
          title: acpDisplayName(event.message),
          body: update ? eventBody(update) : "",
        });
        return;
      }

      flushYield(index);
      hasFinalEvent = hasFinalEvent || event.message === "ACP::Stop";
      bubbles.push({
        id: `acp-activity-${index}`,
        type: "activity",
        title: acpDisplayName(event.message),
        body: acpActivityBody(event),
      });
      return;
    }

    if (event.type === "state" || event.type === "state-change") {
      flushYield(index);
      const state = stateBubblePayload(event.data);
      if (!state) return;
      hasFinalEvent = hasFinalEvent || event.type === "state";
      bubbles.push({
        id: `${event.type}-${index}`,
        type: event.type,
        body: eventBody(state.value),
        title: state.path,
        state,
      });
      return;
    }

    flushYield(index);
    hasFinalEvent = event.type === "result" || event.type === "error";
    const body =
      event.type === "error"
        ? errorBubbleBody(event.data)
        : eventBody(event.data);
    if (
      event.type === "result" &&
      bubbles.some((bubble) => bubble.type === "agent") &&
      bubbles
        .filter((bubble) => bubble.type === "agent")
        .map((bubble) => bubble.body)
        .join("") === body
    ) {
      return;
    }
    bubbles.push({
      id: `${event.type}-${index}`,
      type: event.type === "error" ? "error" : "result",
      body,
    });
  });

  flushYield(result.events.length);
  if (!result.streaming && !hasFinalEvent) {
    bubbles.push({
      id: "result-done",
      type: result.ok ? "result" : "error",
      body: result.ok ? "Done" : `${result.status}`,
    });
  }
  return bubbles;
}

function hasStateChange(result: ActionRunResult | null): boolean {
  return Boolean(
    result?.events?.some((event) => event.type === "state-change")
  );
}

function yamlScalar(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value !== "string") return JSON.stringify(value) ?? String(value);
  if (!value) return '""';
  if (value.includes("\n")) {
    return `|\n${value
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n")}`;
  }
  if (/[:#{}[\],&*?|\-<>=!%@`"']|\s$|^\s|^(true|false|null)$/i.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function yamlValue(value: unknown, depth = 0): string {
  const indent = "  ".repeat(depth);
  const childIndent = "  ".repeat(depth + 1);

  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return value
      .map((item) => {
        if (
          Array.isArray(item) ||
          (typeof item === "object" && item !== null)
        ) {
          return `${indent}-\n${yamlValue(item, depth + 1)}`;
        }
        return `${indent}- ${yamlScalar(item)}`;
      })
      .join("\n");
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    if (!entries.length) return "{}";
    return entries
      .map(([key, item]) => {
        if (
          Array.isArray(item) ||
          (typeof item === "object" && item !== null)
        ) {
          return `${indent}${key}:\n${yamlValue(item, depth + 1)}`;
        }
        const scalar = yamlScalar(item);
        if (scalar.startsWith("|\n")) {
          return `${indent}${key}: ${scalar.replace(
            /\n/g,
            `\n${childIndent}`
          )}`;
        }
        return `${indent}${key}: ${scalar}`;
      })
      .join("\n");
  }

  return `${indent}${yamlScalar(value)}`;
}

function inputBody(input: unknown): string {
  if (
    input === null ||
    input === undefined ||
    (typeof input === "string" && !input.trim()) ||
    (Array.isArray(input) && !input.length) ||
    (typeof input === "object" &&
      !Array.isArray(input) &&
      !Object.keys(input).length)
  ) {
    return "Empty";
  }

  return yamlValue(input);
}

type DisplayFile = {
  name: string;
  contentBase64: string;
  path: string;
};

function isUploadedFile(value: unknown): value is {
  name: string;
  contentBase64: string;
} {
  const record = recordValue(value);
  return (
    typeof record?.name === "string" &&
    typeof record.contentBase64 === "string"
  );
}

function extractDisplayFiles(
  value: unknown,
  path = "file"
): { value: unknown; files: DisplayFile[] } {
  if (isUploadedFile(value)) {
    return {
      value: undefined,
      files: [{ ...value, path }],
    };
  }

  if (Array.isArray(value)) {
    const files: DisplayFile[] = [];
    const values = value.flatMap((item, index) => {
      const extracted = extractDisplayFiles(item, `${path}[${index}]`);
      files.push(...extracted.files);
      return extracted.value === undefined ? [] : [extracted.value];
    });
    return { value: values.length ? values : undefined, files };
  }

  const record = recordValue(value);
  if (record) {
    const files: DisplayFile[] = [];
    const entries = Object.entries(record).flatMap(([key, item]) => {
      const extracted = extractDisplayFiles(
        item,
        path === "file" ? key : `${path}.${key}`
      );
      files.push(...extracted.files);
      return extracted.value === undefined ? [] : [[key, extracted.value]];
    });
    return {
      value: entries.length ? Object.fromEntries(entries) : undefined,
      files,
    };
  }

  return { value, files: [] };
}

function uploadedFileSize(contentBase64: string): string {
  const padding = contentBase64.endsWith("==")
    ? 2
    : contentBase64.endsWith("=")
      ? 1
      : 0;
  const bytes = Math.max(
    0,
    Math.floor((contentBase64.length * 3) / 4) - padding
  );
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function ActionInputBody({ input }: { input: unknown }) {
  const display = extractDisplayFiles(input);
  if (!display.files.length) {
    return (
      <MessageContent
        data-slot="action-input-bubble"
        style={{ overflowWrap: "anywhere" }}
      >
        <MessageResponse className="text-primary-foreground">
          {inputBody(input)}
        </MessageResponse>
      </MessageContent>
    );
  }

  return (
    <>
      {display.value !== undefined ? (
        <MessageContent
          data-slot="action-input-bubble"
          style={{ overflowWrap: "anywhere" }}
        >
          <MessageResponse className="text-primary-foreground">
            {inputBody(display.value)}
          </MessageResponse>
        </MessageContent>
      ) : null}
      <div
        data-slot="action-input-files"
        className="flex max-w-full flex-col gap-2 self-end"
      >
        {display.files.map((file, index) => (
          <div
            key={`${file.path}:${file.name}:${index}`}
            className="flex min-w-0 max-w-full items-center gap-3 rounded-lg border border-border bg-white px-3 py-2 text-black"
          >
            <FileTextIcon
              aria-hidden="true"
              className="size-5 shrink-0 text-black/60"
            />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{file.name}</div>
              <div className="truncate text-xs text-black/60">
                {uploadedFileSize(file.contentBase64)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function actionInputHasBubble(input: unknown): boolean {
  const display = extractDisplayFiles(input);
  return !display.files.length || display.value !== undefined;
}

function chatInputBody(input: unknown): string {
  if (
    input === null ||
    input === undefined ||
    (typeof input === "object" &&
      !Array.isArray(input) &&
      !Object.keys(input).length)
  ) {
    return "";
  }

  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    for (const key of ["content", "prompt", "message", "text"]) {
      const value = (input as Record<string, unknown>)[key];
      if (typeof value === "string") return value;
    }
  }

  return inputBody(input);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

function displayCell(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  const text =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : JSON.stringify(value) ?? String(value);
  return isUuid(text) ? `${text.slice(0, 8)}…` : text;
}

function isTruncatedId(value: unknown): value is string {
  return typeof value === "string" && isUuid(value);
}

function tableRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.map((item) => (isRecord(item) ? item : { value: item }));
  }
  return [isRecord(value) ? value : { value }];
}

function rowKey(row: Record<string, unknown>, index: number): string {
  return String(row.id ?? row.key ?? index);
}

function previousRow(
  rows: Record<string, unknown>[],
  row: Record<string, unknown>,
  index: number
): Record<string, unknown> | undefined {
  if (row.id !== undefined)
    return rows.find((candidate) => candidate.id === row.id);
  return rows[index];
}

function humanizeAction(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

function valueAtPath(value: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (current, key) => (isRecord(current) ? current[key] : undefined),
      value
    );
}

function resolveStateActionPayload(
  template: Record<string, string>,
  alias: string,
  row: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(template).map(([key, expression]) => {
      const prefix = `${alias}.`;
      return [
        key,
        expression.startsWith(prefix)
          ? valueAtPath(row, expression.slice(prefix.length))
          : expression,
      ];
    })
  );
}

function matchesStateCondition(value: unknown, condition: unknown): boolean {
  if (!isRecord(condition)) return Object.is(value, condition);
  if (!isRecord(value)) return false;
  return Object.entries(condition).every(([key, expected]) =>
    matchesStateCondition(value[key], expected)
  );
}

function stateActionIsVisible(
  descriptor: StateActionDescriptor,
  row: Record<string, unknown>
): boolean {
  return (
    descriptor.visible === undefined ||
    matchesStateCondition(row, descriptor.visible)
  );
}

function findStateAction(
  config: ConsoleConfig | undefined,
  actor: string | undefined,
  actionName: string
): ConsoleAction | undefined {
  const canonical = (value: string) =>
    value.replace("::", ".").replace(/[_-]/g, "").toLowerCase();
  const expected = canonical(actionName);
  return config?.actions.find(
    (action) =>
      (!actor || action.actor === actor) &&
      (canonical(action.action) === expected ||
        canonical(action.id).endsWith(`.${expected}`))
  );
}

function stateCommandsForActor(
  config: ConsoleConfig | undefined,
  actor: string | undefined
): Record<string, StateActionDescriptor> {
  const commands: Record<string, StateActionDescriptor> = {};

  for (const action of config?.actions ?? []) {
    if (actor && action.actor !== actor) continue;
    if (!isRecord(action.meta) || !isRecord(action.meta.stateCommands)) {
      continue;
    }

    for (const [alias, stateCommands] of Object.entries(
      action.meta.stateCommands
    )) {
      if (!isRecord(stateCommands)) continue;
      for (const [name, definition] of Object.entries(stateCommands)) {
        if (!isRecord(definition)) continue;
        let expanded = false;
        let input: Record<string, unknown> = definition;
        if (isRecord(definition.input)) {
          expanded = true;
          input = definition.input;
        }
        if (!Object.values(input).every((value) => typeof value === "string")) {
          continue;
        }
        commands[name] = {
          alias,
          action: action.action,
          input: input as Record<string, string>,
          ...(expanded && isRecord(definition.visible)
            ? { visible: definition.visible }
            : {}),
        };
      }
    }
  }

  return commands;
}

function StateValueTable({
  state,
  onAction,
  actionPending,
  actionCompleted,
}: {
  state: StateBubblePayload;
  onAction?: (
    name: string,
    descriptor: StateActionDescriptor,
    row: Record<string, unknown>,
    rowIndex: number
  ) => void;
  actionPending?: string | null;
  actionCompleted?: string | null;
}) {
  const rows = tableRows(state.value);
  const oldRows = state.previous === undefined ? [] : tableRows(state.previous);
  const rowColumns = rows.flatMap((row) => Object.keys(row));
  const columns = Array.from(
    new Set([...(state.columns ?? []), ...rowColumns])
  );
  const uuidColumns = new Set(
    columns.filter((column) =>
      [...rows, ...oldRows].some((row) => {
        const value = row[column];
        return typeof value === "string" && isUuid(value);
      })
    )
  );
  const actions = Object.entries(state.actions ?? {});
  const indexedRows = rows.map((row, index) => ({ row, index }));
  const changedIndexes = indexedRows.flatMap(({ row, index }) => {
    const oldRow = previousRow(oldRows, row, index);
    return columns.some(
      (column) =>
        JSON.stringify(oldRow?.[column]) !== JSON.stringify(row[column])
    )
      ? [index]
      : [];
  });
  let visibleRows = indexedRows;
  let leadingHiddenCount = 0;
  let trailingHiddenCount = 0;

  if (state.previous !== undefined && indexedRows.length > 3) {
    const firstChangedIndex = changedIndexes[0] ?? 0;
    const lastChangedIndex = changedIndexes.at(-1) ?? firstChangedIndex;

    if (lastChangedIndex >= indexedRows.length - 2) {
      visibleRows = indexedRows.slice(-2);
      leadingHiddenCount = indexedRows.length - visibleRows.length;
    } else if (firstChangedIndex <= 1) {
      visibleRows = indexedRows.slice(0, 2);
      trailingHiddenCount = indexedRows.length - visibleRows.length;
    } else {
      visibleRows = [indexedRows[firstChangedIndex]!];
      leadingHiddenCount = firstChangedIndex;
      trailingHiddenCount = indexedRows.length - firstChangedIndex - 1;
    }
  }

  if (!rows.length) {
    return (
      <div className="rounded-md border border-border px-3 py-5 text-center text-xs text-muted-foreground">
        No rows
      </div>
    );
  }

  return (
    <div className="w-full max-w-full overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-max border-collapse text-left text-xs">
        <thead className="bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                className={cn(
                  "border-b border-border px-3 py-2 font-semibold",
                  uuidColumns.has(column) && "w-px whitespace-nowrap"
                )}
              >
                {column}
              </th>
            ))}
            {actions.length ? (
              <th className="w-px whitespace-nowrap border-b border-border px-3 py-2 text-right font-semibold">
                Actions
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {leadingHiddenCount > 0 ? (
            <tr className="border-b border-border/70">
              <td
                colSpan={columns.length + (actions.length ? 1 : 0)}
                className="px-3 py-2 text-center text-muted-foreground"
                title={`${leadingHiddenCount} earlier items`}
              >
                …
                <span className="sr-only">
                  {" "}
                  {leadingHiddenCount} earlier items
                </span>
              </td>
            </tr>
          ) : null}
          {visibleRows.map(({ row, index }) => {
            const oldRow = previousRow(oldRows, row, index);
            const rowActions = actions.filter(([, descriptor]) =>
              stateActionIsVisible(descriptor, row)
            );
            const changedColumns = new Set(
              columns.filter(
                (column) =>
                  state.previous !== undefined &&
                  JSON.stringify(oldRow?.[column]) !==
                    JSON.stringify(row[column])
              )
            );
            const allFieldsChanged =
              columns.length > 0 && changedColumns.size === columns.length;
            return (
              <tr
                key={rowKey(row, index)}
                className="border-b border-border/70 last:border-0"
              >
                {columns.map((column) => {
                  const before = oldRow?.[column];
                  const after = row[column];
                  const changed = changedColumns.has(column);
                  const uuidValue =
                    typeof after === "string" && isUuid(after) ? after : null;
                  return (
                    <td
                      key={column}
                      title={
                        typeof after === "string" && isUuid(after)
                          ? after
                          : undefined
                      }
                      className={cn(
                        "max-w-72 px-3 py-2 align-top",
                        uuidColumns.has(column) && "w-px whitespace-nowrap",
                        changed && "state-change-highlight text-black"
                      )}
                    >
                      {changed ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-muted-foreground line-through">
                            <span
                              className={cn(
                                isTruncatedId(before) &&
                                  "inline-block w-[9ch] whitespace-nowrap font-mono"
                              )}
                            >
                              {displayCell(before)}
                            </span>
                          </span>
                          <div className="flex items-center gap-1">
                            <span
                              className={cn(
                                isTruncatedId(after) &&
                                  "inline-block w-[9ch] whitespace-nowrap font-mono"
                              )}
                            >
                              {displayCell(after)}
                            </span>
                            {uuidValue ? (
                              <ResultCopyButton text={uuidValue} />
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span
                            className={cn(
                              isTruncatedId(after) &&
                                "inline-block w-[9ch] whitespace-nowrap font-mono"
                            )}
                          >
                            {displayCell(after)}
                          </span>
                          {uuidValue ? (
                            <ResultCopyButton text={uuidValue} />
                          ) : null}
                        </div>
                      )}
                    </td>
                  );
                })}
                {actions.length ? (
                  <td
                    className={cn(
                      "w-px whitespace-nowrap px-3 py-2 text-right",
                      allFieldsChanged && "state-change-highlight"
                    )}
                  >
                    <div className="flex justify-end gap-1.5">
                      {rowActions.map(([name, descriptor]) => {
                        const actionKey = `${name}:${rowKey(row, index)}`;
                        const completed = actionCompleted === actionKey;
                        return (
                          <Button
                            key={name}
                            type="button"
                            size="sm"
                            variant="outline"
                            className={cn(
                              allFieldsChanged &&
                                "border-black bg-black text-white hover:bg-black hover:text-white"
                            )}
                            disabled={Boolean(actionPending) || completed}
                            onClick={() =>
                              onAction?.(name, descriptor, row, index)
                            }
                          >
                            {actionPending === actionKey
                              ? "Running…"
                              : completed
                              ? "Done"
                              : humanizeAction(name)}
                          </Button>
                        );
                      })}
                    </div>
                  </td>
                ) : null}
              </tr>
            );
          })}
          {trailingHiddenCount > 0 ? (
            <tr>
              <td
                colSpan={columns.length + (actions.length ? 1 : 0)}
                className="px-3 py-2 text-center text-muted-foreground"
                title={`${trailingHiddenCount} later items`}
              >
                …
                <span className="sr-only">
                  {" "}
                  {trailingHiddenCount} later items
                </span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function StateBubble({
  state,
  config,
  actor,
  onActionStart,
  onActionResult,
}: {
  state: StateBubblePayload;
  config?: ConsoleConfig;
  actor?: string;
  onActionStart: (call: {
    name: string;
    action: string;
    input: Record<string, unknown>;
  }) => void;
  onActionResult: (result: ActionRunResult) => void;
}) {
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<ActionRunResult | null>(
    null
  );
  const discoveredActions = stateCommandsForActor(config, actor);
  const actionableState = {
    ...state,
    actions: {
      ...discoveredActions,
      ...state.actions,
    },
  };

  const invokeStateAction = useCallback(
    async (
      name: string,
      descriptor: StateActionDescriptor,
      row: Record<string, unknown>,
      rowIndex: number
    ) => {
      const { alias, action: actionName, input: template } = descriptor;
      const actionInput = resolveStateActionPayload(template, alias, row);
      onActionStart({ name, action: actionName, input: actionInput });
      const action = findStateAction(config, actor, actionName);
      if (!action || !config) {
        const unavailableResult: ActionRunResult = {
          status: 404,
          ok: false,
          contentType: "text/plain",
          body: `Action ${actionName} is not available`,
        };
        setActionResult(unavailableResult);
        onActionResult(unavailableResult);
        return;
      }

      const pendingKey = `${name}:${rowKey(row, rowIndex)}`;
      setActionPending(pendingKey);
      setLastAction(pendingKey);
      setActionResult(null);
      try {
        let finalResult: ActionRunResult | null = null;
        const response = await fetch(action.route, {
          method: "POST",
          headers: {
            Accept: "text/event-stream, application/json",
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            wind: "commander",
          },
          body: JSON.stringify(actionInput),
        });
        for await (const update of streamActionResponse(response)) {
          finalResult = update;
          setActionResult(update);
        }
        if (finalResult) onActionResult(finalResult);
      } catch (error) {
        const failedResult: ActionRunResult = {
          status: 500,
          ok: false,
          contentType: "text/plain",
          body: error instanceof Error ? error.message : String(error),
        };
        setActionResult(failedResult);
        onActionResult(failedResult);
      } finally {
        setActionPending(null);
      }
    },
    [actor, config, onActionResult, onActionStart]
  );
  const completedAction = hasStateChange(actionResult) ? lastAction : null;

  return (
    <div className="flex w-full max-w-full flex-col gap-2">
      <StateValueTable
        state={actionableState}
        onAction={invokeStateAction}
        actionPending={actionPending}
        actionCompleted={completedAction}
      />
    </div>
  );
}

function ActionCallMessage({
  bubble,
}: {
  bubble: Extract<AppendedStateActionBubble, { type: "action" }>;
}) {
  const actionLabel = scopedBubbleLabel(
    bubble.actor,
    sentenceFromIdentifier(bubble.action)
  );

  return (
    <Message from="user">
      <div className="flex items-center gap-1 self-end text-[11px] font-semibold text-muted-foreground">
        {actionLabel}
        <ArrowUpRightIcon
          aria-hidden="true"
          className="mr-2 shrink-0"
          size={24}
        />
      </div>
      <ActionInputBody input={bubble.input} />
    </Message>
  );
}

function ResultCopyButton({
  text,
  timeout = 2000,
}: {
  text: string;
  timeout?: number;
}) {
  const [isCopied, setIsCopied] = useState(false);
  const timeoutRef = useRef<number>(0);

  const copyToClipboard = useCallback(async () => {
    if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
      return;
    }

    if (isCopied) return;

    await navigator.clipboard.writeText(text);
    setIsCopied(true);
    timeoutRef.current = window.setTimeout(() => setIsCopied(false), timeout);
  }, [isCopied, text, timeout]);

  useEffect(
    () => () => {
      window.clearTimeout(timeoutRef.current);
    },
    []
  );

  const Icon = isCopied ? CheckIcon : CopyIcon;

  return (
    <Button
      aria-label={isCopied ? "Copied" : "Copy result"}
      className="h-6 w-6 bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground focus:bg-transparent focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 active:bg-transparent"
      disabled={!text}
      onClick={copyToClipboard}
      size="icon-sm"
      title={isCopied ? "Copied" : "Copy result"}
      type="button"
      variant="ghost"
    >
      <Icon className="size-3.5" size={14} />
    </Button>
  );
}

export function ActionResult({
  className,
  input,
  result,
  runs,
  chat,
  showLogs,
  config,
  action,
  onScrollChange: _onScrollChange,
}: {
  className?: string;
  input?: unknown;
  result?: ActionRunResult | null;
  runs?: { id: string; input: unknown; result: ActionRunResult | null }[];
  chat?: boolean;
  showLogs: boolean;
  config?: ConsoleConfig;
  action?: ConsoleAction;
  onScrollChange?: (scrollTop: number) => void;
}) {
  const [appendedStateActions, setAppendedStateActions] = useState<
    AppendedStateActionBubble[]
  >([]);
  const appendedStateActionId = useRef(0);
  const runItems =
    runs ??
    (input !== undefined ? [{ id: "run", input, result: result ?? null }] : []);
  const appendStateActionResult = useCallback(
    (actionResult: ActionRunResult, actorName?: string) => {
      const bubbles = buildRunBubbles(actionResult, false);
      const appended = bubbles.flatMap<AppendedStateActionBubble>((bubble) => {
        const id = `state-action-${++appendedStateActionId.current}`;
        if (
          (bubble.type === "state" || bubble.type === "state-change") &&
          bubble.state
        ) {
          return [
            {
              id,
              type: bubble.type,
              state: bubble.state,
              actor: actorName,
            },
          ];
        }
        if (bubble.type === "error") {
          return [{ id, type: "error", body: bubble.body, actor: actorName }];
        }
        return [];
      });
      if (appended.length) {
        setAppendedStateActions((current) => [...current, ...appended]);
      }
    },
    []
  );
  const appendStateActionCall = useCallback(
    (
      call: {
        name: string;
        action: string;
        input: Record<string, unknown>;
      },
      actorName?: string
    ) => {
      setAppendedStateActions((current) => [
        ...current,
        {
          id: `state-action-${++appendedStateActionId.current}`,
          type: "action",
          ...call,
          actor: actorName,
        },
      ]);
    },
    []
  );

  return (
    <Conversation className={cn("min-h-0 flex-1", className)}>
      <ConversationContent>
        <ScrollToAppendedStateActions count={appendedStateActions.length} />
        {runItems.length ? (
          runItems.flatMap((run) => {
            const bubbles = buildRunBubbles(run.result, showLogs).filter(
              (bubble) => !chat || bubble.type !== "result"
            );
            const waiting = !run.result || run.result.streaming;
            const chatInput = chat ? chatInputBody(run.input) : "";
            return [
              chat && !chatInput ? null : (
                <Message key={`${run.id}-input`} from="user">
                  {!chat && actionInputHasBubble(run.input) ? (
                    <div className="self-end text-[11px] font-semibold text-muted-foreground">
                      Input
                    </div>
                  ) : null}
                  {chat ? (
                    <MessageContent
                      className="space-y-2"
                      style={{ overflowWrap: "anywhere" }}
                    >
                      <MessageResponse className="text-primary-foreground">
                        {chatInput}
                      </MessageResponse>
                    </MessageContent>
                  ) : (
                    <ActionInputBody input={run.input} />
                  )}
                </Message>
              ),
              ...(bubbles.length
                ? bubbles.map((bubble) =>
                    bubble.type === "yield" || bubble.type === "agent" ? (
                      <Message key={`${run.id}-${bubble.id}`} from="assistant">
                        <div
                          className="max-w-[88%] text-foreground"
                          style={{ overflowWrap: "anywhere" }}
                        >
                          <MessageResponse>{bubble.body}</MessageResponse>
                        </div>
                      </Message>
                    ) : bubble.type === "thought" ? (
                      <Message key={`${run.id}-${bubble.id}`} from="assistant">
                        <Reasoning
                          className="mb-0 max-w-[88%]"
                          defaultOpen={false}
                          isStreaming={waiting}
                        >
                          <ReasoningTrigger className="w-auto text-[11px] font-semibold" />
                          <ReasoningContent className="mt-2 border-l-[1.5px] border-border px-4 py-3">
                            {bubble.body}
                          </ReasoningContent>
                        </Reasoning>
                      </Message>
                    ) : (
                      <Message
                        key={`${run.id}-${bubble.id}`}
                        from="assistant"
                        className={cn(
                          (bubble.type === "state" ||
                            bubble.type === "state-change") &&
                            "max-w-full"
                        )}
                      >
                        <div className="flex max-w-full items-center gap-1">
                          <div
                            className={cn(
                              "text-[11px] font-semibold text-muted-foreground",
                              bubble.type === "error" && "text-destructive"
                            )}
                          >
                            {bubble.type === "wind"
                              ? bubble.title
                              : bubble.type === "tool" ||
                                bubble.type === "plan" ||
                                bubble.type === "activity"
                              ? bubble.title
                              : bubble.type === "state"
                              ? `Result`
                              : bubble.type === "state-change"
                              ? stateChangeLabel(bubble.title!, action?.actor)
                              : bubble.type === "error"
                              ? "Error"
                              : "Result"}
                          </div>
                          {bubble.type === "result" ||
                          bubble.type === "error" ? (
                            <ResultCopyButton text={bubble.body} />
                          ) : null}
                        </div>
                        <MessageContent
                          className={cn(
                            bubble.type === "wind" &&
                              "border-l-[1.5px] border-border px-4 py-3 text-muted-foreground",
                            bubble.type === "activity" &&
                              "border-l-[1.5px] border-border px-4 py-3 text-muted-foreground",
                            (bubble.type === "tool" ||
                              bubble.type === "plan") &&
                              "rounded-lg border border-border bg-action px-4 py-3 text-foreground",
                            (bubble.type === "state" ||
                              bubble.type === "state-change") &&
                              "w-full",
                            bubble.type === "result" &&
                              "rounded-lg border border-border bg-action px-4 py-3 text-foreground",
                            bubble.type === "error" &&
                              "rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive"
                          )}
                          style={{ overflowWrap: "anywhere" }}
                        >
                          {bubble.type === "state" ||
                          bubble.type === "state-change" ? (
                            <StateBubble
                              state={bubble.state!}
                              config={config}
                              actor={action?.actor}
                              onActionStart={(call) =>
                                appendStateActionCall(call, action?.actor)
                              }
                              onActionResult={(actionResult) =>
                                appendStateActionResult(
                                  actionResult,
                                  action?.actor
                                )
                              }
                            />
                          ) : bubble.type === "wind" ? (
                            <pre className="whitespace-pre-wrap font-mono text-[11px] leading-4 text-black">
                              {(bubble.body || "Done")
                                .split("\n")
                                .map((line, index) => (
                                  <TraceLine
                                    key={`${run.id}-${bubble.id}-line-${index}`}
                                    line={line}
                                  />
                                ))}
                            </pre>
                          ) : (
                            <MessageResponse>{bubble.body}</MessageResponse>
                          )}
                        </MessageContent>
                      </Message>
                    )
                  )
                : waiting
                ? [
                    <Message key={`${run.id}-waiting`} from="assistant">
                      <MessageContent className="text-muted-foreground">
                        <span
                          aria-hidden="true"
                          className="inline-block size-3 rounded-full bg-landing-primary motion-safe:animate-pulse"
                          style={{ animationDuration: "1s" }}
                        />
                      </MessageContent>
                    </Message>,
                  ]
                : []),
            ];
          })
        ) : (
          <Message from="assistant">
            <MessageContent className="border-dashed text-muted-foreground">
              Send a message to start chatting
            </MessageContent>
          </Message>
        )}
        {appendedStateActions.map((bubble) =>
          bubble.type === "action" ? (
            <ActionCallMessage key={bubble.id} bubble={bubble} />
          ) : bubble.type === "error" ? (
            <Message key={bubble.id} from="assistant">
              <div className="flex max-w-full items-center gap-1">
                <div className="text-[11px] font-semibold text-destructive">
                  Error
                </div>
                <ResultCopyButton text={bubble.body} />
              </div>
              <MessageContent className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive">
                <MessageResponse>{bubble.body}</MessageResponse>
              </MessageContent>
            </Message>
          ) : (
            <Message key={bubble.id} from="assistant" className="max-w-full">
              <div className="text-[11px] font-semibold text-muted-foreground">
                {bubble.type === "state"
                  ? `Result`
                  : stateChangeLabel(bubble.state.path, bubble.actor)}
              </div>
              <MessageContent
                className="w-full"
                style={{ overflowWrap: "anywhere" }}
              >
                <StateBubble
                  state={bubble.state}
                  config={config}
                  actor={bubble.actor}
                  onActionStart={(call) =>
                    appendStateActionCall(call, bubble.actor)
                  }
                  onActionResult={(actionResult) =>
                    appendStateActionResult(actionResult, bubble.actor)
                  }
                />
              </MessageContent>
            </Message>
          )
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
