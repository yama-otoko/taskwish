import type { Pretty } from "./types";

export class Message<
  const MessageType extends string = string,
  Data = unknown,
  Log = Data
> {
  public readonly log: Log;

  constructor(
    public readonly message: MessageType,
    public data: Data,
    public readonly symbol?: string
  ) {
    this.log = constructLog(message, data, symbol) as Log;
  }

  toSSE(): Uint8Array {
    const raw =
      JSON.stringify(this.data, serializeSseValue) ?? String(this.data);
    const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const output =
      [
        `event: ${this.message}`,
        ...lines.map((line) => `data: ${line}`),
        "",
      ].join("\n") + "\n";

    return new TextEncoder().encode(output);
  }
}

function constructLog(
  message: string,
  data: unknown,
  symbol?: string
): unknown {
  if (symbol === undefined || data === null || typeof data !== "object") {
    return data;
  }

  const record = data as Record<string, unknown>;
  const subjectKey =
    "path" in record ? "path" : "event" in record ? "event" : null;
  if (subjectKey === null) {
    const update = record.update;
    if (update !== null && typeof update === "object") {
      const { update: _update, ...metadata } = record;
      return Object.assign({ [symbol]: message }, metadata, update);
    }
    return Object.assign({ [symbol]: message }, record);
  }

  const { [subjectKey]: subject, ...params } = record;
  return Object.assign({ [symbol]: subject }, params);
}

function serializeSseValue(_key: string, value: unknown): unknown {
  return value instanceof Error ? { message: value.message } : value;
}

export class Signal<
  const EventType extends string = string,
  Data = Record<string, unknown>
> extends Message<
  "TW::Signal",
  { event: EventType; data: Data },
  { "->": EventType; data: Data }
> {
  constructor(public readonly event: EventType, data: Data) {
    super("TW::Signal", { event, data }, "->");
  }
}

export class Trace<
  const Path extends string = string,
  Data extends object = Record<string, unknown>
> extends Message<
  "TW::Trace",
  Pretty<{ path: Path } & Data>,
  Pretty<{ ">>": Path } & Data>
> {
  constructor(public readonly path: Path, public readonly params: Data) {
    super("TW::Trace", Object.assign({ path }, params), ">>");
  }
}

export class Stream<const Data> extends Message<"TW::Stream", Data> {
  constructor(data: Data) {
    super("TW::Stream", data);
  }
}

/** ACP session-update discriminators supported by the wire protocol. */
export type AcpSessionUpdateName =
  | "user_message_chunk"
  | "agent_message_chunk"
  | "agent_thought_chunk"
  | "tool_call"
  | "tool_call_update"
  | "plan"
  | "plan_update"
  | "plan_removed"
  | "available_commands_update"
  | "current_mode_update"
  | "config_option_update"
  | "session_info_update"
  | "usage_update"
  | "notice"
  | "compaction_update"
  | "compaction_summary_chunk";

/**
 * Structural ACP notification types keep `@taskwish/wire` independent of a
 * particular ACP SDK release while preserving the concrete payload passed to
 * each message constructor.
 */
export type AcpSessionUpdate<
  Name extends AcpSessionUpdateName = AcpSessionUpdateName
> = { sessionUpdate: Name; [key: string]: unknown };

export type AcpSessionNotification<
  Name extends AcpSessionUpdateName = AcpSessionUpdateName
> = {
  sessionId: string;
  update: AcpSessionUpdate<Name>;
  _meta?: Record<string, unknown> | null;
};

export type AcpMessageLog<MessageType extends string> = {
  "~>": MessageType;
  [key: string]: unknown;
};

export class AcpUserMessageChunk extends Message<
  "ACP::UserMessageChunk",
  AcpSessionNotification<"user_message_chunk">,
  AcpMessageLog<"ACP::UserMessageChunk">
> {
  constructor(data: AcpSessionNotification<"user_message_chunk">) {
    super("ACP::UserMessageChunk", data, "~>");
  }
}

export class AcpAgentMessageChunk extends Message<
  "ACP::AgentMessageChunk",
  AcpSessionNotification<"agent_message_chunk">,
  AcpMessageLog<"ACP::AgentMessageChunk">
> {
  constructor(data: AcpSessionNotification<"agent_message_chunk">) {
    super("ACP::AgentMessageChunk", data, "~>");
  }
}

export class AcpAgentThoughtChunk extends Message<
  "ACP::AgentThoughtChunk",
  AcpSessionNotification<"agent_thought_chunk">,
  AcpMessageLog<"ACP::AgentThoughtChunk">
> {
  constructor(data: AcpSessionNotification<"agent_thought_chunk">) {
    super("ACP::AgentThoughtChunk", data, "~>");
  }
}

export class AcpToolCall extends Message<
  "ACP::ToolCall",
  AcpSessionNotification<"tool_call">,
  AcpMessageLog<"ACP::ToolCall">
> {
  constructor(data: AcpSessionNotification<"tool_call">) {
    super("ACP::ToolCall", data, "~>");
  }
}

export class AcpToolCallUpdate extends Message<
  "ACP::ToolCallUpdate",
  AcpSessionNotification<"tool_call_update">,
  AcpMessageLog<"ACP::ToolCallUpdate">
> {
  constructor(data: AcpSessionNotification<"tool_call_update">) {
    super("ACP::ToolCallUpdate", data, "~>");
  }
}

export class AcpPlan extends Message<
  "ACP::Plan",
  AcpSessionNotification<"plan">,
  AcpMessageLog<"ACP::Plan">
> {
  constructor(data: AcpSessionNotification<"plan">) {
    super("ACP::Plan", data, "~>");
  }
}

export class AcpPlanUpdate extends Message<
  "ACP::PlanUpdate",
  AcpSessionNotification<"plan_update">,
  AcpMessageLog<"ACP::PlanUpdate">
> {
  constructor(data: AcpSessionNotification<"plan_update">) {
    super("ACP::PlanUpdate", data, "~>");
  }
}

export class AcpPlanRemoved extends Message<
  "ACP::PlanRemoved",
  AcpSessionNotification<"plan_removed">,
  AcpMessageLog<"ACP::PlanRemoved">
> {
  constructor(data: AcpSessionNotification<"plan_removed">) {
    super("ACP::PlanRemoved", data, "~>");
  }
}

export class AcpAvailableCommandsUpdate extends Message<
  "ACP::AvailableCommandsUpdate",
  AcpSessionNotification<"available_commands_update">,
  AcpMessageLog<"ACP::AvailableCommandsUpdate">
> {
  constructor(data: AcpSessionNotification<"available_commands_update">) {
    super("ACP::AvailableCommandsUpdate", data, "~>");
  }
}

export class AcpCurrentModeUpdate extends Message<
  "ACP::CurrentModeUpdate",
  AcpSessionNotification<"current_mode_update">,
  AcpMessageLog<"ACP::CurrentModeUpdate">
> {
  constructor(data: AcpSessionNotification<"current_mode_update">) {
    super("ACP::CurrentModeUpdate", data, "~>");
  }
}

export class AcpConfigOptionUpdate extends Message<
  "ACP::ConfigOptionUpdate",
  AcpSessionNotification<"config_option_update">,
  AcpMessageLog<"ACP::ConfigOptionUpdate">
> {
  constructor(data: AcpSessionNotification<"config_option_update">) {
    super("ACP::ConfigOptionUpdate", data, "~>");
  }
}

export class AcpSessionInfoUpdate extends Message<
  "ACP::SessionInfoUpdate",
  AcpSessionNotification<"session_info_update">,
  AcpMessageLog<"ACP::SessionInfoUpdate">
> {
  constructor(data: AcpSessionNotification<"session_info_update">) {
    super("ACP::SessionInfoUpdate", data, "~>");
  }
}

export class AcpUsageUpdate extends Message<
  "ACP::UsageUpdate",
  AcpSessionNotification<"usage_update">,
  AcpMessageLog<"ACP::UsageUpdate">
> {
  constructor(data: AcpSessionNotification<"usage_update">) {
    super("ACP::UsageUpdate", data, "~>");
  }
}

export class AcpNotice extends Message<
  "ACP::Notice",
  AcpSessionNotification<"notice">,
  AcpMessageLog<"ACP::Notice">
> {
  constructor(data: AcpSessionNotification<"notice">) {
    super("ACP::Notice", data, "~>");
  }
}

export class AcpCompactionUpdate extends Message<
  "ACP::CompactionUpdate",
  AcpSessionNotification<"compaction_update">,
  AcpMessageLog<"ACP::CompactionUpdate">
> {
  constructor(data: AcpSessionNotification<"compaction_update">) {
    super("ACP::CompactionUpdate", data, "~>");
  }
}

export class AcpCompactionSummaryChunk extends Message<
  "ACP::CompactionSummaryChunk",
  AcpSessionNotification<"compaction_summary_chunk">,
  AcpMessageLog<"ACP::CompactionSummaryChunk">
> {
  constructor(data: AcpSessionNotification<"compaction_summary_chunk">) {
    super("ACP::CompactionSummaryChunk", data, "~>");
  }
}

export type AcpStopData = {
  response: unknown;
  stopReason: string;
};

/** The final response produced by an ACP active session. */
export class AcpStop extends Message<
  "ACP::Stop",
  AcpStopData,
  AcpMessageLog<"ACP::Stop">
> {
  constructor(data: AcpStopData) {
    super("ACP::Stop", data, "~>");
  }
}

export type AcpSessionMessage =
  | AcpUserMessageChunk
  | AcpAgentMessageChunk
  | AcpAgentThoughtChunk
  | AcpToolCall
  | AcpToolCallUpdate
  | AcpPlan
  | AcpPlanUpdate
  | AcpPlanRemoved
  | AcpAvailableCommandsUpdate
  | AcpCurrentModeUpdate
  | AcpConfigOptionUpdate
  | AcpSessionInfoUpdate
  | AcpUsageUpdate
  | AcpNotice
  | AcpCompactionUpdate
  | AcpCompactionSummaryChunk;

export type AcpActiveSessionMessage =
  | {
      kind: "session_update";
      notification: AcpSessionNotification;
      update: AcpSessionUpdate;
    }
  | ({ kind: "stop" } & AcpStopData);

/** Converts every ACP active-session event into its dedicated wire message. */
export function acpMessage(
  message: AcpActiveSessionMessage
): AcpSessionMessage | AcpStop {
  if (message.kind === "stop") {
    return new AcpStop({
      response: message.response,
      stopReason: message.stopReason,
    });
  }

  return acpSessionUpdateMessage(message.notification);
}

/** Converts every ACP `session/update` variant into a dedicated wire message. */
export function acpSessionUpdateMessage(
  notification: AcpSessionNotification
): AcpSessionMessage {
  switch (notification.update.sessionUpdate) {
    case "user_message_chunk":
      return new AcpUserMessageChunk(
        notification as AcpSessionNotification<"user_message_chunk">
      );
    case "agent_message_chunk":
      return new AcpAgentMessageChunk(
        notification as AcpSessionNotification<"agent_message_chunk">
      );
    case "agent_thought_chunk":
      return new AcpAgentThoughtChunk(
        notification as AcpSessionNotification<"agent_thought_chunk">
      );
    case "tool_call":
      return new AcpToolCall(
        notification as AcpSessionNotification<"tool_call">
      );
    case "tool_call_update":
      return new AcpToolCallUpdate(
        notification as AcpSessionNotification<"tool_call_update">
      );
    case "plan":
      return new AcpPlan(notification as AcpSessionNotification<"plan">);
    case "plan_update":
      return new AcpPlanUpdate(
        notification as AcpSessionNotification<"plan_update">
      );
    case "plan_removed":
      return new AcpPlanRemoved(
        notification as AcpSessionNotification<"plan_removed">
      );
    case "available_commands_update":
      return new AcpAvailableCommandsUpdate(
        notification as AcpSessionNotification<"available_commands_update">
      );
    case "current_mode_update":
      return new AcpCurrentModeUpdate(
        notification as AcpSessionNotification<"current_mode_update">
      );
    case "config_option_update":
      return new AcpConfigOptionUpdate(
        notification as AcpSessionNotification<"config_option_update">
      );
    case "session_info_update":
      return new AcpSessionInfoUpdate(
        notification as AcpSessionNotification<"session_info_update">
      );
    case "usage_update":
      return new AcpUsageUpdate(
        notification as AcpSessionNotification<"usage_update">
      );
    case "notice":
      return new AcpNotice(
        notification as AcpSessionNotification<"notice">
      );
    case "compaction_update":
      return new AcpCompactionUpdate(
        notification as AcpSessionNotification<"compaction_update">
      );
    case "compaction_summary_chunk":
      return new AcpCompactionSummaryChunk(
        notification as AcpSessionNotification<"compaction_summary_chunk">
      );
  }
}

/** A value returned as the result of an action. */
export class Result<const Data = unknown> extends Message<"TW::Result", Data> {
  constructor(data: Data) {
    super("TW::Result", data);
  }
}

/** A structured description of an actor-state mutation. */
export class StateChange<
  const Path extends string = string,
  const Params extends object = Record<string, unknown>
> extends Message<
  "TW::StateChange",
  Pretty<{ path: Path } & Params>,
  Pretty<{ ":=": Path } & Params>
> {
  constructor(public readonly path: Path, public readonly params: Params) {
    super("TW::StateChange", Object.assign({ path }, params), ":=");
  }
}

/** A state value returned as the result of an action. */
export class StateResult<
  const Path extends string = string,
  const Params extends object = Record<string, unknown>
> extends Message<
  "TW::StateResult",
  Pretty<{ path: Path } & Params>,
  Pretty<{ "=>": Path } & Params>
> {
  constructor(public readonly path: Path, public readonly params: Params) {
    super("TW::StateResult", Object.assign({ path }, params), "=>");
  }
}

export function messageData(message: unknown): unknown {
  return isTaskWishMessage(message) ? message.data : message;
}

export function messageLogData(message: unknown): unknown {
  return message instanceof Message ? message.log : message;
}

type TaskWishMessage =
  | Signal
  | Trace
  | Result
  | StateChange
  | StateResult
  | AcpSessionMessage
  | AcpStop;

function isTaskWishMessage(message: unknown): message is TaskWishMessage {
  if (message === null || typeof message !== "object") return false;

  const messageType = (message as { message?: unknown }).message;

  return (
    messageType === "TW::Signal" ||
    messageType === "TW::Trace" ||
    messageType === "TW::Result" ||
    messageType === "TW::StateChange" ||
    messageType === "TW::StateResult" ||
    (typeof messageType === "string" && messageType.startsWith("ACP::"))
  );
}
