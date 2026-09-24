import { TW } from "@taskwish/core";
import type { Output } from "ai";
import { acpMessage } from "@taskwish/wind";
import {
  CodexAgent,
  type CodexAgentOptions,
  type CodexAskOptions,
  type CodexPromptInput,
  type CodexPromptOptions,
} from "./codex-agent";
import {
  AiSdkAgent,
  type AiSdkAgentOptions,
  type TaskWishLanguageModel,
} from "./ai-sdk-agent";
import { FxAgent, type FxAgentOptions } from "./fx-agent";
import type { CamelCase } from "./helpers";
import type { ProviderModelName } from "./provider";
import { isTaskWishTool, type TaskWishTool } from "./tool";

type AgentRuntimeKind = "ai-sdk" | "codex" | "fx";
type CodexAgentRuntimeOptions = CodexAgentOptions & {
  runtime: "codex";
  name?: string;
  output?: never;
};

type FxAgentRuntimeOptions = FxAgentOptions & {
  runtime: "fx";
  name?: string;
  output?: never;
};

export type AgentOptions =
  | AiSdkAgentOptions
  | CodexAgentRuntimeOptions
  | FxAgentRuntimeOptions;

type ScopedModelName<Ctx> = Ctx extends {
  scope: { [TW.Provider]: infer Providers };
}
  ? ProviderModelName<Providers[keyof Providers]>
  : never;

type AgentOptionsFor<Ctx> =
  | (Omit<AiSdkAgentOptions, "model"> & {
      model: TaskWishLanguageModel | ScopedModelName<Ctx> | (string & {});
    })
  | CodexAgentRuntimeOptions
  | FxAgentRuntimeOptions;

type NamedAgentOptionsFor<
  Ctx,
  Tools extends readonly string[]
> = AgentOptionsFor<Ctx> extends infer Options
  ? Options extends unknown
    ? Omit<Options, "name" | "tools"> & { tools?: Tools }
    : never
  : never;

export type AgentOptionsFactory<Scope = any> = (scope: Scope) => AgentOptions;

export type AgentChatInput = {
  content: string;
  sessionId: string;
};

export type AgentChatMessageInput = AgentChatInput;

export type AgentChatThread = {
  sessionId: string;
};

type AgentOutput<Options> = Options extends {
  output: Output.Output<infer Value>;
}
  ? Value
  : string;

export interface AgentRuntime<Generated = string> {
  readonly name: string;
  readonly runtime: AgentRuntimeKind;
  readonly client: AiSdkAgent | CodexAgent | FxAgent;
  ask(input?: string | CodexAskOptions): AsyncGenerator<string, string>;
  chat(): Promise<AgentChatThread>;
  chat(input: AgentChatInput): AsyncGenerator<string, string>;
  chat<const Input extends TW.Union<AgentChatInput | void>>(
    input: Input
  ): Input extends TW.Union<infer Data>
    ? Data extends void
      ? TW.Branch<{ input: void }, AgentChatThread, Promise<AgentChatThread>>
      : TW.Branch<{ input: Data }, string, AsyncGenerator<string, string>>
    : never;
  prompt(
    input?: CodexPromptInput | CodexPromptOptions
  ): AsyncGenerator<string, string>;
  generate(options: {
    prompt: string;
    abortSignal?: AbortSignal;
  }): Promise<Generated>;
  close(): Promise<void>;
  [TW.ActionObserver]?(
    actionName: string,
    publish: (event: unknown) => void
  ): (() => Iterable<unknown>) & { dispose?: () => void };
}

type AgentStep<
  Name extends string,
  Ctx extends Record<any, any>,
  Generated = string
> = {
  [TW.Step]: (input: Ctx) => {
    name: Ctx["name"];
    steps: Ctx["steps"];
    step: Ctx["step"];
    scope: Record<Name, AgentRuntime<Generated>> & Ctx["scope"];
    last: AgentRuntime<Generated>;
    plugins: Ctx["plugins"];
  };
};

export function Agent<
  const Options extends AgentOptionsFor<Ctx>,
  Ctx extends Record<any, any>
>(
  options: Options
): (() => AgentRuntime<AgentOutput<Options>>) &
  AgentStep<"agent", Ctx, AgentOutput<Options>>;
export function Agent<
  const Options extends AgentOptions,
  Ctx extends Record<any, any>
>(
  options: (scope: any) => Options
): (() => AgentRuntime<AgentOutput<Options>>) &
  AgentStep<"agent", Ctx, AgentOutput<Options>>;
export function Agent<
  const Name extends string,
  const Tools extends readonly string[],
  Ctx extends Record<any, any>,
  const Options extends NamedAgentOptionsFor<Ctx, Tools>
>(
  name: CamelCase<Name>,
  options: Options
): (() => AgentRuntime<AgentOutput<Options>>) &
  AgentStep<Name, Ctx, AgentOutput<Options>>;
export function Agent(first: unknown, second?: unknown) {
  const configuredName = typeof first === "string" ? first : "agent";
  const optionsOrFactory: AgentOptions | AgentOptionsFactory =
    typeof first === "string"
      ? ({
          ...(second as Record<string, unknown> | undefined),
          runtime:
            (second as { runtime?: AgentRuntimeKind } | undefined)?.runtime ??
            "ai-sdk",
          name: first,
        } as AgentOptions)
      : (first as AgentOptions | AgentOptionsFactory);
  let runtime: AgentRuntime | null = null;

  function agentStep(this: unknown): AgentRuntime {
    const scope = this as Record<PropertyKey, unknown>;
    const override = scope[configuredName];
    if (override !== undefined) {
      registerActionObserver(scope, override);
      return override as AgentRuntime;
    }
    if (runtime) {
      registerActionObserver(scope, runtime);
      return runtime;
    }

    const configuredOptions =
      typeof optionsOrFactory === "function"
        ? optionsOrFactory(scope)
        : optionsOrFactory;

    if (!configuredOptions) {
      throw new Error("Agent options are required.");
    }

    let options = {
      ...configuredOptions,
      runtime: configuredOptions.runtime ?? "ai-sdk",
      name: configuredOptions.name ?? configuredName,
    } as AgentOptions;

    if (
      (options.runtime === undefined || options.runtime === "ai-sdk") &&
      typeof options.model === "string"
    ) {
      const scopedModel = resolveScopedModel(scope[TW.Provider], options.model);
      if (isLanguageModel(scopedModel)) {
        options = { ...options, model: scopedModel };
      }
    }

    if (
      options.runtime !== "ai-sdk" &&
      options.runtime !== "codex" &&
      options.runtime !== "fx"
    ) {
      throw new Error('Agent runtime must be "ai-sdk", "codex", or "fx".');
    }

    runtime = createAgentRuntime(options, scope);
    registerActionObserver(scope, runtime);
    return runtime;
  }

  return Object.assign(agentStep, {
    [TW.Name]: configuredName,
    [TW.Step]: (input: Record<string, unknown>) => {
      const scope = input.scope as Record<string, unknown>;
      const agent = scope[configuredName] ?? agentStep.call(scope);
      return {
        ...input,
        scope: {
          ...scope,
          [configuredName]: agent,
        },
        last: agent,
      };
    },
  }) as never;
}

function resolveScopedModel(
  value: unknown,
  qualifiedModel: string
): TaskWishLanguageModel | undefined {
  if (value === null || typeof value !== "object") return undefined;

  for (const candidate of Object.values(value)) {
    if (!isProviderRegistration(candidate)) continue;
    const prefix = `${candidate.provider}/`;
    if (!qualifiedModel.startsWith(prefix)) continue;

    const modelId = qualifiedModel.slice(prefix.length);
    if (!candidate.models.includes(modelId)) return undefined;
    return candidate.model(modelId);
  }

  return undefined;
}

function isProviderRegistration(value: unknown): value is {
  provider: string;
  models: readonly string[];
  model: (modelId: string) => TaskWishLanguageModel;
} {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { provider?: unknown }).provider === "string" &&
    Array.isArray((value as { models?: unknown }).models) &&
    typeof (value as { model?: unknown }).model === "function"
  );
}

function isLanguageModel(value: unknown): value is TaskWishLanguageModel {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { doGenerate?: unknown }).doGenerate === "function" &&
    typeof (value as { doStream?: unknown }).doStream === "function"
  );
}

function registerActionObserver(
  scope: Record<string | symbol, unknown>,
  value: unknown
): void {
  const register = scope[TW.ActionObserver];
  if (typeof register === "function") {
    (register as (value: unknown) => void)(value);
  }
}

function createAgentRuntime(
  options: AgentOptions,
  scope: Record<string, unknown>
): AgentRuntime {
  if (options.runtime === undefined || options.runtime === "ai-sdk") {
    return createAiSdkAgentRuntime(options, scope);
  }

  type SessionMessage = Parameters<
    NonNullable<CodexAgentOptions["onSessionUpdate"]>
  >[0];
  const actionPublishers = new Set<(event: unknown) => void>();
  const publishSessionMessage = (message: SessionMessage) => {
    const event = acpMessage(message);
    for (const publish of actionPublishers) publish(event);
  };
  const createClient = (opts: AgentOptions) => {
    const acpOptions = opts as CodexAgentOptions;
    const onSessionUpdate = acpOptions.onSessionUpdate;
    const observedOptions = {
      ...opts,
      async onSessionUpdate(message: SessionMessage) {
        publishSessionMessage(message);
        await onSessionUpdate?.(message);
      },
    };

    return options.runtime === "fx"
      ? new FxAgent(observedOptions as FxAgentOptions)
      : new CodexAgent(observedOptions as CodexAgentOptions);
  };
  const client = createClient(options);
  const sessionClients = new Map<string, CodexAgent>();

  function chat(): Promise<AgentChatThread>;
  function chat(input: void): Promise<AgentChatThread>;
  function chat(input: AgentChatInput): AsyncGenerator<string, string>;
  function chat<const Input extends TW.Union<AgentChatInput | void>>(
    input: Input
  ): Input extends TW.Union<infer Data>
    ? Data extends void
      ? TW.Branch<{ input: void }, AgentChatThread, Promise<AgentChatThread>>
      : TW.Branch<{ input: Data }, string, AsyncGenerator<string, string>>
    : never;
  function chat(
    input?: AgentChatInput | TW.Union<AgentChatInput | void> | void
  ) {
    input = input instanceof TW.Union ? input.unwrap() : input;
    if (!input?.content) {
      return createChatSession();
    }

    if (!input.sessionId) {
      throw new Error("Agent chat sessionId is required.");
    }

    return streamChatMessage({
      sessionId: input.sessionId,
      content: input.content,
    });
  }

  return {
    name: options.name ?? "agent",
    runtime: options.runtime,
    client,

    async *ask(input?: string | CodexAskOptions) {
      const prompt = normalizePrompt(input);
      const stream = client.streamAsk(
        typeof prompt === "string" || "prompt" in prompt ? prompt : { prompt }
      );
      let next = await stream.next();
      while (!next.done) {
        yield next.value;
        next = await stream.next();
      }
      return next.value;
    },

    chat,

    async *prompt(input?: CodexPromptInput | CodexPromptOptions) {
      const prompt = normalizePrompt(input);
      const stream = client.streamPrompt(
        typeof prompt === "string" || Array.isArray(prompt) || "type" in prompt
          ? { prompt }
          : prompt
      );
      let next = await stream.next();
      while (!next.done) {
        yield next.value;
        next = await stream.next();
      }
      return next.value.text;
    },

    generate({ prompt }) {
      return client.generateText(prompt);
    },

    [TW.ActionObserver](_actionName, publish) {
      actionPublishers.add(publish);
      const observation = Object.assign(() => [], {
        dispose: () => actionPublishers.delete(publish),
      });
      return observation;
    },

    async close() {
      await Promise.all([
        client.close(),
        ...Array.from(sessionClients.values()).map((sessionClient) =>
          sessionClient.close()
        ),
      ]);
      sessionClients.clear();
    },
  };

  async function createChatSession(): Promise<AgentChatThread> {
    const sessionClient = createClient(options);
    const session = await sessionClient.createSession({ newSession: true });
    sessionClients.set(session.sessionId, sessionClient);
    return { sessionId: session.sessionId };
  }

  async function* streamChatMessage(message: {
    sessionId: string;
    content: string;
  }): AsyncGenerator<string, string> {
    const sessionClient = sessionClients.get(message.sessionId);
    if (!sessionClient) {
      throw new Error(`Unknown agent chat session: ${message.sessionId}`);
    }

    const stream = sessionClient.streamPrompt({
      prompt: message.content,
      newSession: false,
    });
    let next = await stream.next();
    while (!next.done) {
      yield next.value;
      next = await stream.next();
    }
    return next.value.text;
  }
}

function createAiSdkAgentRuntime(
  options: AiSdkAgentOptions,
  scope: Record<string, unknown>
): AgentRuntime<any> {
  const actionPublishers = new Set<(event: unknown) => void>();
  const client = new AiSdkAgent(
    options,
    resolveTools(options.tools, scope),
    (event) => {
      for (const publish of actionPublishers) publish(event);
    }
  );

  function chat(): Promise<AgentChatThread>;
  function chat(input: void): Promise<AgentChatThread>;
  function chat(input: AgentChatInput): AsyncGenerator<string, string>;
  function chat<const Input extends TW.Union<AgentChatInput | void>>(
    input: Input
  ): Input extends TW.Union<infer Data>
    ? Data extends void
      ? TW.Branch<{ input: void }, AgentChatThread, Promise<AgentChatThread>>
      : TW.Branch<{ input: Data }, string, AsyncGenerator<string, string>>
    : never;
  function chat(
    input?: AgentChatInput | TW.Union<AgentChatInput | void> | void
  ) {
    input = input instanceof TW.Union ? input.unwrap() : input;
    if (!input?.content) return client.createChatSession();
    return client.streamChatMessage(input);
  }

  return {
    name: options.name ?? "agent",
    runtime: "ai-sdk",
    client,

    async *ask(input?: string | CodexAskOptions) {
      return yield* client.streamPrompt(promptText(input));
    },

    chat,

    async *prompt(input?: CodexPromptInput | CodexPromptOptions) {
      return yield* client.streamPrompt(promptText(input));
    },

    generate({ prompt, abortSignal }) {
      return client.generate(prompt, abortSignal);
    },

    [TW.ActionObserver](_actionName, publish) {
      actionPublishers.add(publish);
      return Object.assign(() => [], {
        dispose: () => actionPublishers.delete(publish),
      });
    },

    close() {
      return client.close();
    },
  };
}

function resolveTools(
  names: readonly string[] | undefined,
  scope: Record<string, unknown>
): Record<string, TaskWishTool> {
  return Object.fromEntries(
    (names ?? []).map((name) => {
      const candidate = scope[name];
      if (!isTaskWishTool(candidate)) {
        throw new Error(
          `Agent tool "${name}" was not registered. Add Tool("${name}", ...) before Agent(...).`
        );
      }
      return [name, candidate];
    })
  );
}

function promptText(input: unknown): string {
  const normalized = normalizePrompt(input);
  if (typeof normalized === "string") return normalized;
  if (
    normalized !== null &&
    typeof normalized === "object" &&
    "prompt" in normalized &&
    typeof normalized.prompt === "string"
  ) {
    return normalized.prompt;
  }
  throw new Error("AI SDK agent prompts must be strings.");
}

function normalizePrompt<T>(input: T | undefined): T | string {
  if (input !== undefined) return input;
  throw new Error("Agent prompt is required.");
}
