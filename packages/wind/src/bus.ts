import { formatEvent } from "./format";
import type { LogFn } from "./logger";
import * as WindMessage from "./messages";

type WindEventListener<Data = unknown> = (data: Data) => unknown;

const eventListeners: Record<string, WindEventListener[] | undefined> = {};

export class WindEvents {
  addListener<const EventType extends string, Data>(
    type: EventType,
    listener: WindEventListener<Data>
  ): this {
    addListener(type, listener);

    return this;
  }

  on<const EventType extends string, Data>(
    type: EventType,
    listener: WindEventListener<Data>
  ): this {
    return this.addListener(type, listener);
  }

  removeListener<const EventType extends string, Data>(
    type: EventType,
    listener: WindEventListener<Data>
  ): this {
    removeListener(type, listener);

    return this;
  }

  off<const EventType extends string, Data>(
    type: EventType,
    listener: WindEventListener<Data>
  ): this {
    return this.removeListener(type, listener);
  }

  emit<const EventType extends string, Data>(
    type: EventType,
    data: Data
  ): boolean {
    return emit(type, data);
  }
}

export const events = new WindEvents();

export function addListener<const EventType extends string, Data>(
  type: EventType,
  listener: WindEventListener<Data>
): void {
  let listeners = eventListeners[type];

  if (listeners === undefined) {
    listeners = [];
    eventListeners[type] = listeners;
  }

  listeners[listeners.length] = listener as WindEventListener;
}

export function removeListener<const EventType extends string, Data>(
  type: EventType,
  listener: WindEventListener<Data>
): void {
  const listeners = eventListeners[type];

  if (listeners === undefined) return;

  for (let index = 0; index < listeners.length; index++) {
    if (listeners[index] === listener) {
      listeners.splice(index, 1);
      break;
    }
  }

  if (listeners.length === 0) {
    delete eventListeners[type];
  }
}

export function emit<const EventType extends string, Data>(
  type: EventType,
  data: Data
): boolean {
  const listeners = eventListeners[type];

  if (listeners === undefined) return false;

  for (const listener of listeners) {
    listener(data);
  }

  return true;
}

export type WindLogConfig = "console" | LogFn;

export type WindConfig = {
  threadId?: string;
  log?: WindLogConfig;
  services?: unknown[];
};

export type WindGlobalConfig = WindConfig;

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_TIME_LENGTH = 10;
const ULID_RANDOM_LENGTH = 16;

let globalThreadId: string | undefined = undefined;
let globalLog: WindLogConfig | undefined = undefined;

export function configureWind(config: WindGlobalConfig): WindGlobalConfig {
  for (const key in config) {
    if (key === "threadId") {
      globalThreadId = config[key];
    } else if (key === "log") {
      globalLog = config[key];
    }
  }

  return getWindConfig();
}

export function getWindConfig(): WindGlobalConfig {
  return { threadId: globalThreadId, log: globalLog };
}

export function ulid(now = Date.now()): string {
  return encodeTime(now, ULID_TIME_LENGTH) + encodeRandom(ULID_RANDOM_LENGTH);
}

export class Wind {
  declare readonly threadId: string;
  declare readonly log: WindLogConfig | undefined;

  constructor(config?: WindConfig) {
    let threadId = globalThreadId;
    let log = globalLog;

    if (config !== undefined) {
      for (const key in config) {
        if (key === "threadId") {
          threadId = config[key];
        } else if (key === "log") {
          log = config[key];
        }
      }
    }

    this.threadId = threadId ?? ulid();
    this.log = log;
  }

  trace(type: string, data: Record<string, unknown>): Record<string, unknown> {
    const loggedEvent: Record<string, unknown> = { ">>": type };
    const log = this.log;

    for (const key in data) {
      loggedEvent[key] = data[key];
    }

    loggedEvent.threadId = this.threadId;

    if (log === undefined) {
      return loggedEvent;
    } else if (log === "console") {
      console.log(formatEvent(loggedEvent));
    } else {
      log(loggedEvent);
    }

    return loggedEvent;
  }

  signal<const EventType extends string>(
    type: EventType,
    data: Record<string, unknown>
  ): Record<string, unknown> {
    const loggedEvent: Record<string, unknown> = { "->": type };
    const log = this.log;

    for (const key in data) {
      loggedEvent[key] = data[key];
    }

    loggedEvent.threadId = this.threadId;

    if (log === "console") {
      console.log(formatEvent(loggedEvent));
    } else if (log !== undefined) {
      log(loggedEvent);
    }

    emit(type, data);

    return loggedEvent;
  }
}

export namespace Wind {
  export import Message = WindMessage.Message;
  export import Signal = WindMessage.Signal;
  export import Trace = WindMessage.Trace;
  export import Stream = WindMessage.Stream;
  export import Result = WindMessage.Result;
  export import StateChange = WindMessage.StateChange;
  export import StateResult = WindMessage.StateResult;
  export import AcpUserMessageChunk = WindMessage.AcpUserMessageChunk;
  export import AcpAgentMessageChunk = WindMessage.AcpAgentMessageChunk;
  export import AcpAgentThoughtChunk = WindMessage.AcpAgentThoughtChunk;
  export import AcpToolCall = WindMessage.AcpToolCall;
  export import AcpToolCallUpdate = WindMessage.AcpToolCallUpdate;
  export import AcpPlan = WindMessage.AcpPlan;
  export import AcpPlanUpdate = WindMessage.AcpPlanUpdate;
  export import AcpPlanRemoved = WindMessage.AcpPlanRemoved;
  export import AcpAvailableCommandsUpdate = WindMessage.AcpAvailableCommandsUpdate;
  export import AcpCurrentModeUpdate = WindMessage.AcpCurrentModeUpdate;
  export import AcpConfigOptionUpdate = WindMessage.AcpConfigOptionUpdate;
  export import AcpSessionInfoUpdate = WindMessage.AcpSessionInfoUpdate;
  export import AcpUsageUpdate = WindMessage.AcpUsageUpdate;
  export import AcpCompactionUpdate = WindMessage.AcpCompactionUpdate;
  export import AcpCompactionSummaryChunk = WindMessage.AcpCompactionSummaryChunk;
  export import AcpStop = WindMessage.AcpStop;
}

function encodeTime(now: number, length: number): string {
  if (!Number.isFinite(now) || now < 0) {
    throw new Error("Cannot generate a ULID from an invalid timestamp.");
  }

  let time = Math.floor(now);
  let value = "";

  for (let i = 0; i < length; i++) {
    const mod = time % 32;
    value = ENCODING.charAt(mod) + value;
    time = (time - mod) / 32;
  }

  return value;
}

function encodeRandom(length: number): string {
  const bytes = randomBytes(length);
  let value = "";

  for (let i = 0; i < length; i++) {
    value += ENCODING.charAt(bytes[i]! & 31);
  }

  return value;
}

function randomBytes(length: number): number[] {
  const bytes: number[] = [];

  for (let index = 0; index < length; index++) {
    bytes[index] = Math.floor(Math.random() * 256);
  }

  return bytes;
}
