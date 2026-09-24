import { describe, expect, mock, test } from "bun:test";
import { Actor, Step, TW } from "@taskwish/core";
import {
  AcpAgentMessageChunk,
  AcpAgentThoughtChunk,
  AcpStop,
  AcpToolCall,
  AcpToolCallUpdate,
  AcpUsageUpdate,
  AcpUserMessageChunk,
} from "@taskwish/wind";
import { Output, jsonSchema } from "ai";
import { MockLanguageModelV3 } from "ai/test";

import { Agent } from "./agent";
import { Provider } from "./provider";
import { Tool } from "./tool";

const usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: {
    total: 1,
    text: 1,
    reasoning: 0,
  },
};

type MockStreamResult = Awaited<
  ReturnType<MockLanguageModelV3["doStream"]>
>;
type MockStreamPart = MockStreamResult["stream"] extends ReadableStream<infer Part>
  ? Part
  : never;

function streamResult(parts: readonly MockStreamPart[]): MockStreamResult {
  return {
    stream: new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
  };
}

describe("Tool", () => {
  test("is directly executable", async () => {
    const add = Tool("add", {
      description: "Add two numbers",
      input: { left: "number", right: "number" },
      run() {
        return this.input.left + this.input.right;
      },
    });

    expect(await add({ left: 2, right: 3 })).toBe(5);
    expect(add.name).toBe("add");
    expect(add.description).toBe("Add two numbers");
  });
});

describe("Agent AI SDK runtime", () => {
  test("resolves merged provider-qualified model names from internal actor scope", async () => {
    const { Ollama } = Provider("Ollama", {
      baseURL: "http://127.0.0.1:11434/v1",
      models: ["qwen3:4b"],
    });
    const { Vllm } = Provider("Vllm", {
      baseURL: "http://127.0.0.1:8000/v1",
      models: ["deepseek-r1"],
    });
    const expectedModel =
      Ollama[TW.Scope][TW.Provider].Ollama.model("qwen3:4b");
    const { actor } = Actor("ProviderAgent").use(Ollama).use(Vllm);
    const { inspectModel } = actor()
      .on("Command", "inspectModel")
      .run(
        Agent({ model: "ollama/qwen3:4b" }),

        Step("model", function () {
          // Provider registries are framework metadata, not user-facing scope.
          // @ts-expect-error TW.Provider is hidden from handler scope
          this[TW.Provider];
          return (this.agent.client as any).client.settings.model;
        })
      );

    expect(await inspectModel()).toBe(expectedModel);
  });

  test("defaults to AI SDK and executes named TaskWish tools", async () => {
    const toolInputs: Array<{ left: number; right: number }> = [];
    const model = new MockLanguageModelV3({
      doStream: [
        streamResult([
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "add",
            input: JSON.stringify({ left: 2, right: 3 }),
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: undefined },
            usage,
          },
        ]),
        streamResult([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: "The answer is 5." },
          { type: "text-end", id: "text-1" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: undefined },
            usage,
          },
        ]),
      ],
    });
    const { actor } = Actor("Calculator");
    const { calculate } = actor()
      .on("Command", "calculate")

      .run(
        Tool("add", {
          description: "Add two numbers",
          input: { left: "number", right: "number" },
          run() {
            toolInputs.push(this.input);
            return this.input.left + this.input.right;
          },
        }),

        Agent({ model, tools: ["add"] }),

        Step("answer", function () {
          expect(this.agent.runtime).toBe("ai-sdk");
          return this.agent.generate({
            prompt: "What is 2 + 3? Use the add tool.",
          });
        })
      );

    await expect(calculate()).resolves.toBe("The answer is 5.");
    expect(toolInputs).toEqual([{ left: 2, right: 3 }]);
    expect(model.doStreamCalls).toHaveLength(2);
    expect(model.doStreamCalls[0]?.tools?.[0]).toMatchObject({
      name: "add",
      description: "Add two numbers",
    });
  });

  test("reports an unregistered named tool", async () => {
    const model = new MockLanguageModelV3();
    const { actor } = Actor("MissingTool");
    const { runAgent } = actor()
      .on("Command", "runAgent")

      .run(
        Agent({ model, tools: ["missing"] }),

        Step("answer", function () {
          return this.agent.generate({ prompt: "Hello" });
        })
      );

    await expect(runAgent()).rejects.toThrow(
      'Agent tool "missing" was not registered'
    );
  });

  test("emits ACP wind messages from AI SDK generate calls", async () => {
    let releaseTool: ((value: string) => void) | undefined;
    const model = new MockLanguageModelV3({
      doStream: [
        streamResult([
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "wait",
            input: JSON.stringify({}),
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: undefined },
            usage,
          },
        ]),
        streamResult([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: "Finished" },
          { type: "text-end", id: "text-1" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: undefined },
            usage,
          },
        ]),
      ],
    });
    const { actor } = Actor("AiSdkUpdates");
    const { generate } = actor()
      .on("Command", "generate")
      .run(
        Tool("wait", {
          description: "Wait for release",
          input: {},
          run() {
            return new Promise<string>((resolve) => {
              releaseTool = resolve;
            });
          },
        }),
        Agent({ model, tools: ["wait"] }),
        Step("answer", function () {
          return this.agent.generate({ prompt: "Wait, then answer" });
        })
      );

    const stream = generate.stream();
    const events: unknown[] = [];
    let update = await stream.next();
    while (!update.done && !(update.value instanceof AcpToolCall)) {
      events.push(update.value);
      update = await stream.next();
    }

    expect(update.done).toBe(false);
    if (!update.done) events.push(update.value);
    expect(events.some((event) => event instanceof AcpUserMessageChunk)).toBe(
      true
    );
    expect(events.some((event) => event instanceof AcpToolCall)).toBe(true);

    releaseTool?.("released");
    update = await stream.next();
    while (!update.done) {
      events.push(update.value);
      update = await stream.next();
    }

    expect(update.value).toBe("Finished");
    expect(events.some((event) => event instanceof AcpToolCallUpdate)).toBe(
      true
    );
    expect(events.some((event) => event instanceof AcpAgentMessageChunk)).toBe(
      true
    );
    expect(events.some((event) => event instanceof AcpUsageUpdate)).toBe(true);
    expect(events.some((event) => event instanceof AcpStop)).toBe(true);
  });

  test("streams generated text chunks before generate resolves", async () => {
    let releaseStream: (() => void) | undefined;
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "text-1" });
            controller.enqueue({
              type: "text-delta",
              id: "text-1",
              delta: "Hel",
            });
            releaseStream = () => {
              controller.enqueue({
                type: "text-delta",
                id: "text-1",
                delta: "lo",
              });
              controller.enqueue({ type: "text-end", id: "text-1" });
              controller.enqueue({
                type: "finish",
                finishReason: { unified: "stop", raw: undefined },
                usage,
              });
              controller.close();
            };
          },
        }),
      }),
    });
    const { actor } = Actor("ChunkedGenerate");
    const { generate } = actor()
      .on("Command", "generate")
      .run(
        Agent({ model }),
        Step("answer", function () {
          return this.agent.generate({ prompt: "Hello" });
        })
      );
    const stream = generate.stream();

    let next = await stream.next();
    while (!next.done && !(next.value instanceof AcpAgentMessageChunk)) {
      next = await stream.next();
    }

    expect(next.done).toBe(false);
    if (!next.done) {
      const chunk = next.value as unknown as AcpAgentMessageChunk;
      expect(chunk.data.update.content).toEqual({
        type: "text",
        text: "Hel",
      });
    }

    releaseStream?.();
    while (!next.done) next = await stream.next();
    expect(next.value).toBe("Hello");
  });

  test("returns schema-validated structured output", async () => {
    const model = new MockLanguageModelV3({
      doStream: streamResult([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "text-1" },
        {
          type: "text-delta",
          id: "text-1",
          delta: JSON.stringify({ reference: "BOL-1042" }),
        },
        { type: "text-end", id: "text-1" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: undefined },
          usage,
        },
      ]),
    });
    const { actor } = Actor("StructuredAgent");
    const { extract } = actor()
      .on("Command", "extract")
      .run(
        Agent({
          model,
          output: Output.object({
            schema: jsonSchema<{ reference: string }>({
              type: "object",
              properties: { reference: { type: "string" } },
              required: ["reference"],
              additionalProperties: false,
            }),
          }),
        }),
        Step("result", function () {
          return this.agent.generate({ prompt: "Extract the reference" });
        })
      );

    await expect(extract()).resolves.toEqual({ reference: "BOL-1042" });
    expect(model.doStreamCalls[0]?.responseFormat).toMatchObject({
      type: "json",
    });
  });

  test("preserves an explicitly selected Codex runtime", async () => {
    const { actor } = Actor("ExplicitRuntime");
    const { inspectRuntime } = actor()
      .on("Command", "inspectRuntime")

      .run(
        Agent({
          runtime: "codex",
          cwd: process.cwd(),
          permission: "reject_once",
        }),

        Step("runtime", function () {
          return this.agent.runtime;
        })
      );

    await expect(inspectRuntime()).resolves.toBe("codex");
  });

  test("streams ACP updates emitted while generate-style promises are awaited", async () => {
    let finish: ((value: string) => void) | undefined;
    const { actor } = Actor("AcpUpdates");
    const { generate } = actor()
      .on("Command", "generate")

      .run(
        Agent({ runtime: "codex", command: "unused" }),

        Step("answer", async function () {
          const notify = (
            this.agent.client as unknown as {
              options: {
                onSessionUpdate(message: unknown): Promise<void>;
              };
            }
          ).options.onSessionUpdate;
          await notify({
            kind: "session_update",
            notification: {
              sessionId: "session-1",
              update: {
                sessionUpdate: "agent_thought_chunk",
                content: { type: "text", text: "Thinking" },
              },
            },
            update: {
              sessionUpdate: "agent_thought_chunk",
              content: { type: "text", text: "Thinking" },
            },
          });
          return await new Promise<string>((resolve) => {
            finish = resolve;
          });
        })
      );
    const stream = generate.stream();

    let update = await stream.next();
    while (!update.done && !(update.value instanceof AcpAgentThoughtChunk)) {
      update = await stream.next();
    }
    expect(update.done).toBe(false);
    if (!update.done) {
      expect(update.value).toBeInstanceOf(AcpAgentThoughtChunk);
    }

    finish?.("done");
    let next = await stream.next();
    while (!next.done) next = await stream.next();
    expect(next.value).toBe("done");
  });

  test("exposes named agents under their configured scope names", async () => {
    const model = new MockLanguageModelV3({
      doStream: streamResult([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", delta: "A plan" },
        { type: "text-end", id: "text-1" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: undefined },
          usage,
        },
      ]),
    });
    const { actor } = Actor("NamedAgent");
    const { createPlan } = actor()
      .on("Command", "createPlan")

      .run(
        Agent("planner", { model }),

        Step("plan", function () {
          expect(this.planner.name).toBe("planner");
          return this.planner.generate({ prompt: "Create a plan" });
        })
      );

    await expect(createPlan()).resolves.toBe("A plan");
  });

  test("ctx overrides default and named agents for tests", async () => {
    const model = new MockLanguageModelV3();
    const defaultGenerate = mock(async () => "mock default");
    const plannerGenerate = mock(async () => "mock plan");
    const { actor } = Actor("MockedAgents");
    const { runAgents } = actor()
      .on("Command", "runAgents")

      .run(
        Agent({ model }),

        Agent("planner", { model }),

        Step("generate", async function () {
          return {
            default: await this.agent.generate({ prompt: "default" }),
            plan: await this.planner.generate({ prompt: "plan" }),
          };
        })
      );

    await expect(
      runAgents
        .ctx({
          agent: { generate: defaultGenerate },
          planner: { generate: plannerGenerate },
        })
        .run()
    ).resolves.toEqual({
      default: "mock default",
      plan: "mock plan",
    });
    expect(defaultGenerate).toHaveBeenCalledWith({ prompt: "default" });
    expect(plannerGenerate).toHaveBeenCalledWith({ prompt: "plan" });
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});
