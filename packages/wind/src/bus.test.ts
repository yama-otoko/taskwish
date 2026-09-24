import { describe, expect, test } from "bun:test";

import { Wind, configureWind, getWindConfig, ulid } from "./bus";
import { formatEvent } from "./format";
import { dispatch } from "./logger";
import {
  AcpStop,
  acpMessage,
  acpSessionUpdateMessage,
  messageData,
  messageLogData,
} from "./messages";

describe("Wind", () => {
  test("exposes message constructors", () => {
    const trace = new Wind.Trace("Worker::run", { result: 1 });
    expect(trace).toBeInstanceOf(Wind.Message);
    expect(trace.message).toBe("TW::Trace");
    expect(trace.path).toBe("Worker::run");
    expect(trace.symbol).toBe(">>");
    expect(messageData(trace)).toEqual({ path: "Worker::run", result: 1 });
    expect(trace.log).toEqual({
      ">>": "Worker::run",
      result: 1,
    });
    expect(messageLogData(trace)).toBe(trace.log);
    expect(new Wind.Stream("chunk").message).toBe("TW::Stream");
    const result = new Wind.Result({ answer: 42 });
    expect(result.message).toBe("TW::Result");
    expect(messageData(result)).toEqual({ answer: 42 });
    expect(new TextDecoder().decode(result.toSSE())).toBe(
      'event: TW::Result\ndata: {"answer":42}\n\n'
    );
    const stateChange = new Wind.StateChange("Counter::state.count", {
      previous: 19,
      value: 20,
    });
    expect(stateChange.message).toBe("TW::StateChange");
    expect(stateChange.path).toBe("Counter::state.count");
    expect(stateChange.symbol).toBe(":=");
    expect(messageData(stateChange)).toEqual({
      path: "Counter::state.count",
      previous: 19,
      value: 20,
    });
    expect(stateChange.log).toEqual({
      ":=": "Counter::state.count",
      previous: 19,
      value: 20,
    });
    const stateResult = new Wind.StateResult("Counter::state.count", {
      value: 20,
    });
    expect(stateResult.message).toBe("TW::StateResult");
    expect(stateResult.data).toEqual({
      path: "Counter::state.count",
      value: 20,
    });
    expect(stateResult.log).toEqual({
      "=>": "Counter::state.count",
      value: 20,
    });
  });

  test("signals expose their event separately from their message kind", () => {
    const signal = new Wind.Signal("Greeter::Message", { name: "Ada" });

    expect(signal).toBeInstanceOf(Wind.Message);
    expect(signal.message).toBe("TW::Signal");
    expect(signal.event).toBe("Greeter::Message");
    expect(signal.data).toEqual({
      event: "Greeter::Message",
      data: { name: "Ada" },
    });
    expect(signal.log).toEqual({
      "->": "Greeter::Message",
      data: { name: "Ada" },
    });
  });

  test("creates a dedicated wind message for every ACP session event", () => {
    const thought = new Wind.AcpAgentThoughtChunk({
      sessionId: "session-1",
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "Thinking" },
      },
    });
    expect(thought).toBeInstanceOf(Wind.Message);
    expect(thought.message).toBe("ACP::AgentThoughtChunk");
    expect(thought.data.update.content).toEqual({
      type: "text",
      text: "Thinking",
    });
    expect(thought.log).toEqual({
      "~>": "ACP::AgentThoughtChunk",
      sessionId: "session-1",
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "Thinking" },
    });

    const updates = [
      ["user_message_chunk", "ACP::UserMessageChunk"],
      ["agent_message_chunk", "ACP::AgentMessageChunk"],
      ["agent_thought_chunk", "ACP::AgentThoughtChunk"],
      ["tool_call", "ACP::ToolCall"],
      ["tool_call_update", "ACP::ToolCallUpdate"],
      ["plan", "ACP::Plan"],
      ["plan_update", "ACP::PlanUpdate"],
      ["plan_removed", "ACP::PlanRemoved"],
      ["available_commands_update", "ACP::AvailableCommandsUpdate"],
      ["current_mode_update", "ACP::CurrentModeUpdate"],
      ["config_option_update", "ACP::ConfigOptionUpdate"],
      ["session_info_update", "ACP::SessionInfoUpdate"],
      ["usage_update", "ACP::UsageUpdate"],
      ["notice", "ACP::Notice"],
      ["compaction_update", "ACP::CompactionUpdate"],
      ["compaction_summary_chunk", "ACP::CompactionSummaryChunk"],
    ] as const;

    for (const [sessionUpdate, messageType] of updates) {
      const notification = {
        sessionId: "session-1",
        update: { sessionUpdate },
      };
      const message = acpSessionUpdateMessage(notification);

      expect(message.message).toBe(messageType);
      expect(messageData(message)).toBe(notification);
    }

    const stop = acpMessage({
      kind: "stop",
      response: { stopReason: "end_turn" },
      stopReason: "end_turn",
    });
    expect(stop).toBeInstanceOf(AcpStop);
    expect(stop.message).toBe("ACP::Stop");
  });

  test("formats ACP messages instead of logging class instances", () => {
    const logs: unknown[] = [];
    const infos: unknown[] = [];
    const errors: unknown[] = [];
    const message = new Wind.AcpAgentMessageChunk({
      sessionId: "session-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "txt-0",
        content: { type: "text", text: "Hello" },
      },
    });

    dispatch({
      log: (event) => logs.push(event),
      info: (event) => infos.push(event),
      error: (event) => errors.push(event),
    })(message);

    expect(logs).toEqual([]);
    expect(errors).toEqual([]);
    expect(infos).toEqual([formatEvent(message.log)]);
  });

  test("generates a ULID thread id by default", () => {
    const wind = new Wind();
    const event = wind.trace("Greeter::hello", { input: { name: "Ada" } });

    expect(wind.threadId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(event.threadId).toBe(wind.threadId);
  });

  test("does not log without instance or global log config", () => {
    const events: unknown[] = [];
    const originalLog = console.log;
    console.log = (event: unknown) => {
      events.push(event);
    };

    try {
      configureWind({ log: undefined, threadId: undefined });
      const wind = new Wind();
      wind.trace("Greeter::hello", { input: { name: "Ada" } });

      expect(events).toEqual([]);
    } finally {
      console.log = originalLog;
    }
  });

  test("logs trace events with a stable thread id", () => {
    const events: unknown[] = [];
    const wind = new Wind({
      threadId: "thread-1",
      log: (event) => events.push(event),
    });

    const event = wind.trace("Greeter::hello", { input: { name: "Ada" } });

    expect(events).toEqual([event]);
    expect(event).toEqual({
      ">>": "Greeter::hello",
      threadId: "thread-1",
      input: { name: "Ada" },
    });
  });

  test("logs and emits signal events with a stable thread id", async () => {
    const loggedEvents: unknown[] = [];
    const emittedEvents: unknown[] = [];
    const { events } = await import("./bus");
    const wind = new Wind({
      threadId: "thread-1",
      log: (event) => loggedEvents.push(event),
    });
    const listener = (event: unknown) => emittedEvents.push(event);

    events.on("Greeter::Message", listener);

    try {
      const event = wind.signal("Greeter::Message", { name: "Ada" });

      expect(loggedEvents).toEqual([event]);
      expect(emittedEvents).toEqual([{ name: "Ada" }]);
      expect(event).toEqual({
        "->": "Greeter::Message",
        threadId: "thread-1",
        name: "Ada",
      });
    } finally {
      events.off("Greeter::Message", listener);
    }
  });

  test("accepts service references in global config", () => {
    const service = { hello: () => "hello" };

    configureWind({ services: [service] });

    expect(getWindConfig()).toEqual({
      threadId: undefined,
      log: undefined,
    });
  });

  test("supports global logging config", () => {
    const events: unknown[] = [];
    configureWind({
      threadId: "thread-global",
      log: (event) => events.push(event),
    });

    try {
      const wind = new Wind();
      const event = wind.trace("Greeter::hello", { input: { name: "Ada" } });

      expect(getWindConfig()).toEqual({
        threadId: "thread-global",
        log: expect.any(Function),
      });
      expect(events).toEqual([event]);
      expect(event).toEqual({
        ">>": "Greeter::hello",
        threadId: "thread-global",
        input: { name: "Ada" },
      });
    } finally {
      configureWind({ log: undefined, threadId: undefined });
    }
  });

  test("supports console logging shorthand", () => {
    const events: unknown[] = [];
    const originalLog = console.log;
    console.log = (event: unknown) => {
      events.push(event);
    };

    try {
      const wind = new Wind({ threadId: "main", log: "console" });
      const event = wind.trace("Greeter::hello", { input: { name: "Ada" } });
      const formattedEvent = stripAnsi(String(events[0]));

      expect(events).toHaveLength(1);
      expect(events[0]).toBeString();
      expect(formattedEvent).toContain(`">>": "Greeter::hello"`);
      expect(formattedEvent).toContain(`"threadId": "main"`);
      expect(formattedEvent).toContain(`"input": { "name": "Ada" }`);
      expect(event).toEqual({
        ">>": "Greeter::hello",
        threadId: "main",
        input: { name: "Ada" },
      });
    } finally {
      console.log = originalLog;
    }
  });

  test("generates canonical ULIDs", () => {
    expect(ulid(0)).toMatch(/^0000000000[0-9A-HJKMNP-TV-Z]{16}$/);
  });
});

function stripAnsi(value: string): string {
  // oxlint-disable-next-line no-control-regex -- ANSI escape sequences begin with ESC.
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}
