import {
  ContextualActionTag,
  RawLoggedStreamTag,
  RawStreamTag,
  buildScope,
  normalizeActionContext,
  resolveMetaExpressionBuilders,
  runAction,
  tapRawStreamWith,
  tapWith,
  unwrapStreamEvents,
  type ActionFactory,
  type ExecutionContext,
} from "./action";
import type { ActionMeta, ValidateActionMeta } from "./action/meta";
import { Event } from "./event";
import {
  CamelCase,
  PascalCase,
  InferSchema,
  ValidateSchema,
  Pretty,
  ExtractActionName,
  ActionRecordName,
  ActionCtx,
  AddActionsToCtxMany,
  DeepWriteable,
  QualifiedActionName,
  QualifiedEventName,
  qualifyActionName,
  qualifyEventName,
  isUnionSchema,
  ToCamelCase,
  toCamelCaseName,
  splitQualifiedActionName,
  ToCapitalCase,
} from "./helpers";
import { TW } from "./core";
import {
  dispatch,
  Signal,
  type ConsoleLike,
  type LoggerConfig,
} from "@taskwish/wind";
import { type Steps } from "./steps/steps";
import { ResultKind } from "./steps/hkt";

type BaseScope<Ctx> = Ctx extends Record<any, any> ? Ctx["scope"] : {};

type RuntimeResult<Result> = Awaited<Result> extends AsyncGenerator<
  any,
  infer Return,
  any
>
  ? Awaited<Return>
  : Result extends Generator<any, infer Return, any>
  ? Return
  : Result;

type EventKeys<Scope> = {
  [K in keyof Scope]: Scope[K] extends TW.EventKind<infer Name, any, any>
    ? K | Name
    : never;
}[keyof Scope] &
  string;

type ExtractEventKind<
  Scope,
  EventName extends string
> = EventName extends keyof Scope
  ? Scope[EventName]
  : {
      [K in keyof Scope]: Scope[K] extends TW.EventKind<infer Name, any, any>
        ? EventName extends K | Name
          ? Scope[K]
          : never
        : never;
    }[keyof Scope];

type ExtractEventInput<Scope, EventName extends string> = ExtractEventKind<
  Scope,
  EventName
> extends { readonly "~data"?: infer D }
  ? D
  : never;

type ExtractEventMeta<Scope, EventName extends string> = ExtractEventKind<
  Scope,
  EventName
> extends TW.EventKind<string, any, infer Meta>
  ? Meta
  : never;

type EventHandlerName<EventName extends string> =
  EventName extends `${infer Actor}::${infer Name}`
    ? `on${Actor}${Name}`
    : EventName extends `${infer Actor}:${infer Name}`
    ? `on${Actor}${Name}`
    : `on${EventName}`;

type EventActionName<EventName extends string, Meta> = Meta extends {
  command: infer Command extends string;
}
  ? Command
  : EventHandlerName<EventName>;

type EventActionMeta<EventName extends string, Meta> = Meta extends {
  command: infer Command extends string;
}
  ? { event: EventName; command: Command }
  : { event: EventName };

type ActorEventExports<Scope, Actor extends string> = Pretty<{
  [K in keyof Scope as Scope[K] extends TW.EventKind<infer Name, any, any>
    ? Name extends `${Actor}::${string}`
      ? K extends `${string}::${string}`
        ? never
        : K
      : never
    : never]: Scope[K];
}>;

export type ScheduleInput = { expression: string; at: Date };
export type ScheduleDefinition = {
  expression: string;
  timezone?: string;
  protect?: boolean;
};

type ScheduleActionFactory<
  Ctx extends Record<any, any>,
  Name extends string = "onSchedule"
> = ActionFactory<Name, Ctx> & {
  command<const CommandName extends string>(
    name: CamelCase<CommandName>
  ): ScheduleActionFactory<
    Pretty<Omit<Ctx, "name"> & { name: CommandName }>,
    CommandName
  >;
};

export type HttpEvent = {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
};

type ValidateHttpSchema<Schema> = {
  [K in keyof Schema]: K extends "params" | "query" | "body" | "headers"
    ? ValidateSchema<Schema[K]>
    : `Unexpected key "${K &
        string}", expected "params" | "query" | "body" | "headers"`;
};

type FlatInput<Schema> = Pretty<
  (Schema extends { params: infer P } ? InferSchema<P> : {}) &
    (Schema extends { query: infer Q } ? InferSchema<Q> : {}) &
    (Schema extends { body: infer B } ? InferSchema<B> : {})
>;

// ── Trait method implementation ───────────────────────────────────────────────

/** Extract the method part from a trait-method name: "::log" → "log" */
type TraitMethodPart<T extends string> = T extends `::${infer M}`
  ? ToCamelCase<M>
  : never;

/**
 * Pull the first-argument type out of a trait action's handler.
 * Yields `void` for no-arg handlers so the overload can produce `() => …`.
 *
 * Uses `Parameters<A>` rather than an `infer I` pattern so that
 * `() => R` correctly yields `void` instead of `unknown`.
 */
type ExtractTraitInput<A> = A extends (...args: any[]) => any
  ? Parameters<A> extends []
    ? void
    : Parameters<A>[0]
  : void;

/** Helper: `(input: I) => Promise<R>` when I is known, `() => Promise<R>` when void. */
type TraitActionHandler<I, R> = [I] extends [void]
  ? () => Promise<R>
  : (input: I) => Promise<R>;

/**
 * Extract the qualified action name carried inside a trait action's stream events.
 * e.g. TW.Action<"::read", …> → "::read".
 */
type ExtractTraitQualifiedName<A> = ExtractActionName<A> extends `::${string}`
  ? ExtractActionName<A>
  : never;

type TraitActionLike<TraitMethod extends `::${string}` = `::${string}`> = ((
  ...args: any[]
) => any) &
  TW.Resource<TraitMethod>;

type ExtractTraitEventName<A> = A extends TW.Attributable<infer Meta>
  ? Meta extends { event: infer EventName extends `::${string}` }
    ? EventName
    : never
  : never;

type TraitEventActionLike<EventName extends `::${string}` = `::${string}`> =
  TraitActionLike<EventName> & TW.Attributable<{ event: EventName }>;

/**
 * Returned by `Behavior.on(Storage.read)` — a fluent builder whose
 * input type is already fixed by the trait instance. No `.input()` call needed.
 */
interface TraitMethodFactoryFromTrait<
  TraitMethod extends `::${string}`,
  Ctx extends Record<any, any>,
  Input
> {
  run<
    const H extends (
      this: TW.Scope<
        Pretty<
          ([Input] extends [void] ? {} : { input: Input }) & BaseScope<Ctx>
        >
      >
    ) => any
  >(
    handler: H
  ): {
    [K in TraitMethodPart<TraitMethod>]: TW.Action<
      QualifiedActionName<Ctx["name"] & string, TraitMethodPart<TraitMethod>>,
      TraitActionHandler<Input, RuntimeResult<ReturnType<H>>>,
      TW.ActionCtxMeta<{ trait: TraitMethod }, ActionCtx<Ctx["scope"]>>
    >;
  };
}

/** The actor factory function returned under an actor's name. */
export interface ActorFactory<Ctx extends Record<any, any>> {
  (): Behavior<Ctx>;
  events: ActorEventExports<BaseScope<Ctx>, Ctx["name"] & string>;
}

type ServiceResult<
  ServiceName extends string,
  Config extends Record<string, unknown>,
  ServiceScope
> = {
  [Name in ToCapitalCase<ServiceName>]: TW.Service<
    ServiceName,
    ServiceActions<Config>,
    ServiceScope
  >;
};

type ServiceActions<Config extends Record<string, unknown>> = Pretty<{
  -readonly [Key in keyof Config as Key extends "public" | "listeners"
    ? never
    : ExtractActionName<Config[Key]> extends infer Name extends string
    ? ActionRecordName<Name>
    : never]: Config[Key];
}>;

type CommandResult<
  CmdName extends string,
  FlatIn,
  Method extends string,
  Path extends string,
  Schema,
  Scope extends Record<any, any>,
  Service extends string,
  Handler extends (...args: any[]) => any,
  Meta = {}
> = {
  [key in CmdName]: TW.Action<
    QualifiedActionName<Service, CmdName>,
    (input: FlatIn) => Promise<RuntimeResult<ReturnType<Handler>>>,
    TW.ActionCtxMeta<
      {
        route: [
          Method,
          Path,
          Pretty<DeepWriteable<Schema> & DeepWriteable<Meta>>
        ];
      },
      ActionCtx<Scope>
    >
  >;
} & {
  meta<
    const NextMeta extends ActionMeta<
      { scope: Pretty<{ input: FlatIn } & Scope> },
      RuntimeResult<ReturnType<Handler>>
    >
  >(
    meta: ValidateActionMeta<
      NextMeta,
      { scope: Pretty<{ input: FlatIn } & Scope> },
      RuntimeResult<ReturnType<Handler>>
    >
  ): CommandResult<
    CmdName,
    FlatIn,
    Method,
    Path,
    Schema,
    Scope,
    Service,
    Handler,
    Pretty<Meta & NextMeta>
  >;
};

interface CommandBody<
  CmdName extends string,
  FlatIn,
  Method extends string,
  Path extends string,
  Schema,
  Scope extends Record<any, any>,
  Service extends string
> {
  use(): this;
  run<
    const H extends (this: TW.Scope<Pretty<{ input: FlatIn } & Scope>>) => any
  >(
    handler: H,
    ...rest: unknown[]
  ): CommandResult<CmdName, FlatIn, Method, Path, Schema, Scope, Service, H>;
}

type BuiltInEventScope = {
  Message: TW.EventKind<
    "Message",
    TW.Union<{ sessionId: string; content: string } | void>,
    { command: "chat" }
  >;
  NewEmail: TW.EventKind<
    "NewEmail",
    { from: string; to: string; subject: string; body: string }
  >;
  NewMessage: TW.EventKind<
    "NewMessage",
    { sender: { name: string }; content: string; channel: string }
  >;
  NewMention: TW.EventKind<
    "NewMention",
    { sender: { name: string }; text: string; channel: string }
  >;
};

const builtInEventScope = {
  ...Event(
    { name: "Message", command: "chat" },
    { sessionId: "string", content: "string" },
    "|",
    "void"
  ),
  ...Event("NewEmail", {
    from: "string",
    to: "string",
    subject: "string",
    body: "string",
  }),
  ...Event("NewMessage", {
    sender: { name: "string" },
    content: "string",
    channel: "string",
  }),
  ...Event("NewMention", {
    sender: { name: "string" },
    text: "string",
    channel: "string",
  }),
} satisfies BuiltInEventScope;

export interface Behavior<Ctx extends Record<any, any>> {
  use(config: LoggerConfig): this;
  use<const Plugins extends readonly unknown[]>(
    ...plugins: Plugins
  ): Behavior<AddActionsToCtxMany<Ctx, Plugins>>;
  service<const Config extends Record<string, unknown> = {}>(
    config?: Config & { public?: never; listeners?: never }
  ): ServiceResult<
    Ctx["name"] & string,
    Config,
    ActorEventExports<BaseScope<Ctx>, Ctx["name"] & string>
  >;

  on<Name extends string>(
    behavior: "Command",
    name: CamelCase<Name>
  ): ActionFactory<
    Name,
    { name: Name; service: Ctx["name"]; scope: BaseScope<Ctx> }
  >;

  on(
    behavior: "Schedule",
    expression: string | ScheduleDefinition
  ): ScheduleActionFactory<
    {
      name: "onSchedule";
      service: Ctx["name"];
      scope: { input: ScheduleInput } & BaseScope<Ctx>;
    }
  >;

  on<
    const Method extends "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
    const Path extends string,
    const Schema
  >(
    behavior: Method,
    path: Path,
    schema: ValidateHttpSchema<Schema>
  ): {
    command<const CmdName extends string>(
      name: CmdName
    ): CommandBody<
      CmdName,
      FlatInput<Schema>,
      Method,
      Path,
      Schema,
      BaseScope<Ctx>,
      Ctx["name"]
    >;
  };

  on<const TraitEventAction extends TraitEventActionLike>(
    behavior: TraitEventAction
  ): ActionFactory<
    EventHandlerName<ExtractTraitEventName<TraitEventAction>>,
    {
      name: EventHandlerName<ExtractTraitEventName<TraitEventAction>>;
      service: Ctx["name"] & string;
      meta: { event: ExtractTraitEventName<TraitEventAction> };
      scope: Pretty<
        ([ExtractTraitInput<TraitEventAction>] extends [void]
          ? {}
          : { input: ExtractTraitInput<TraitEventAction> }) &
          BaseScope<Ctx>
      >;
    }
  >;

  on<const TraitAction extends TraitActionLike>(
    traitMethod: TraitAction
  ): TraitMethodFactoryFromTrait<
    ExtractTraitQualifiedName<TraitAction>,
    Ctx,
    ExtractTraitInput<TraitAction>
  >;

  on<const EventName extends EventKeys<BaseScope<Ctx>>>(
    behavior: EventName
  ): ActionFactory<
    EventActionName<EventName, ExtractEventMeta<BaseScope<Ctx>, EventName>>,
    {
      name: EventActionName<
        EventName,
        ExtractEventMeta<BaseScope<Ctx>, EventName>
      >;
      service: Ctx["name"] & string;
      meta: EventActionMeta<
        EventName,
        ExtractEventMeta<BaseScope<Ctx>, EventName>
      >;
      scope: {
        input: ExtractEventInput<BaseScope<Ctx>, EventName>;
      } & BaseScope<Ctx>;
    }
  >;

  on<const EventName extends string, Input, Meta>(
    behavior: TW.EventKind<EventName, Input, Meta>
  ): ActionFactory<
    EventActionName<EventName, Meta>,
    {
      name: EventActionName<EventName, Meta>;
      service: Ctx["name"] & string;
      meta: EventActionMeta<EventName, Meta>;
      scope: {
        input: Input;
      } & BaseScope<Ctx>;
    }
  >;
}

type RequalifyScopedEvent<
  ActorName extends string,
  Key,
  Value
> = Value extends TW.EventKind<any, infer Input, infer Meta>
  ? Key extends string
    ? Key extends `${string}::${string}`
      ? Value
      : TW.EventKind<QualifiedEventName<ActorName, Key>, Input, Meta>
    : Value
  : Value;

type RequalifyScopedEvents<ActorName extends string, Scope> = Pretty<{
  [Key in keyof Scope]: RequalifyScopedEvent<ActorName, Key, Scope[Key]>;
}>;

type ScopedActorCtx<
  Ctx extends Record<any, any>,
  Last extends Record<any, any>
> = Pretty<
  Omit<Last, "name" | "scope" | "last"> & {
    name: Ctx["name"];
  } & ("scope" extends keyof Last
      ? { scope: RequalifyScopedEvents<Ctx["name"] & string, Last["scope"]> }
      : {}) &
    ("last" extends keyof Last
      ? { last: RequalifyScopedEvents<Ctx["name"] & string, Last["last"]> }
      : {})
>;

/**
 * Used by `Steps<Ctx, ScopeResultKind>` — produces a scoped actor factory
 * `{ actor: () => Behavior<Last> }`.
 */
export interface ScopeResultKind extends ResultKind {
  type: this["ctx"] extends infer Ctx extends Record<any, any>
    ? "name" extends keyof Ctx
      ? Ctx["name"] extends string
        ? this["last"] extends infer Last extends Record<any, any>
          ? {
              [name in "actor"]: ActorFactory<ScopedActorCtx<Ctx, Last>>;
            }
          : never
        : never
      : never
    : never;
}

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH"]);

function capitalCaseName(name: string): string {
  const camel = toCamelCaseName(name);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function eventHandlerName(eventName: string): string {
  if (eventName.includes("::")) {
    const [actor, event] = eventName.split("::");
    return `on${actor}${event}`;
  }
  if (eventName.includes(":")) {
    const [actor, event] = eventName.split(":");
    return `on${actor}${event}`;
  }
  return `on${eventName}`;
}

function matchPathParams(
  pattern: string,
  pathname: string
): Record<string, string> {
  const keys: string[] = [];
  const regexStr = pattern.replace(/:([^/]+)/g, (_, key) => {
    keys.push(key);
    return "([^/]+)";
  });
  const match = pathname.match(new RegExp(`^${regexStr}(?:/.*)?$`));
  if (!match) return {};
  return Object.fromEntries(keys.map((k, i) => [k, match[i + 1]]));
}

type BehaviorMod = { args: unknown[]; scope: Record<string, unknown> };

function makeBehaviorMod(
  behavior: string,
  config?: unknown,
  schema?: unknown
): (args: unknown[]) => BehaviorMod {
  if (behavior === "Schedule") {
    const schedule = normalizeScheduleDefinition(config);
    return (args) => ({
      args: [
        {
          expression: schedule?.expression,
          ...(args[0] as Record<string, unknown>),
        },
      ],
      scope: {},
    });
  }
  if (HTTP_METHODS.has(behavior)) {
    if (schema) {
      return (args) => {
        const arg = args[0];
        let extracted: Record<string, unknown>;
        if (arg instanceof Request) {
          const url = new URL((arg as Request).url);
          extracted = {
            path: url.pathname,
            params:
              typeof config === "string"
                ? matchPathParams(config, url.pathname)
                : {},
            query: Object.fromEntries(url.searchParams.entries()),
          };
        } else {
          extracted = (arg as Record<string, unknown>) ?? {};
        }
        return { args: [extracted], scope: { request: arg } };
      };
    }
    return (args) => ({
      args: [args[0]],
      scope: { request: args[0] },
    });
  }
  return (args) => ({ args, scope: {} });
}

function normalizeScheduleDefinition(
  value: unknown
): ScheduleDefinition | undefined {
  if (typeof value === "string") return { expression: value };
  if (value === null || typeof value !== "object") return undefined;

  const definition = value as Record<string, unknown>;
  if (typeof definition.expression !== "string") return undefined;
  return {
    expression: definition.expression,
    ...(typeof definition.timezone === "string"
      ? { timezone: definition.timezone }
      : {}),
    ...(typeof definition.protect === "boolean"
      ? { protect: definition.protect }
      : {}),
  };
}

function wrapUnionInput(args: unknown[], inputSchema: unknown): unknown[] {
  if (!isUnionSchema(inputSchema) || args[0] instanceof TW.Union) return args;
  return [new TW.Union(args[0]), ...args.slice(1)];
}

function scopeEventKind(
  actorName: string,
  eventName: string,
  eventKind: Record<string | symbol, unknown>
): Record<string | symbol, unknown> {
  const qualifiedEventName = qualifyEventName(actorName, eventName);

  return {
    ...eventKind,
    [TW.Name]: qualifiedEventName,
    emit: async function* (eventData: unknown) {
      const emitted = new Signal(qualifiedEventName, {
        id: null,
        data: eventData,
      });

      yield emitted;
      return emitted;
    },
  };
}

function collectScope(
  steps: unknown[],
  actorName?: string
): Record<string, unknown> {
  const scope: Record<string, unknown> = {};

  const collectEntry = (key: string, value: unknown) => {
    if (
      actorName &&
      value !== null &&
      typeof value === "object" &&
      typeof (value as Record<symbol, unknown>)[TW.ActorScope] === "function"
    ) {
      scope[key] = (
        value as {
          [TW.ActorScope](
            actorName: string,
            steps: readonly unknown[]
          ): unknown;
        }
      )[TW.ActorScope](actorName, steps);
      return;
    }

    const scopedValue =
      actorName &&
      value !== null &&
      typeof value === "object" &&
      "emit" in value &&
      TW.Name in value &&
      typeof (value as Record<string | symbol, unknown>)[TW.Name] ===
        "string" &&
      !(
        (value as Record<string | symbol, unknown>)[TW.Name] as string
      ).includes("::")
        ? scopeEventKind(
            actorName,
            key,
            value as Record<string | symbol, unknown>
          )
        : value;
    scope[key] = scopedValue;

    if (
      actorName &&
      value !== null &&
      typeof value === "object" &&
      "emit" in value &&
      TW.Name in value &&
      typeof (value as Record<string | symbol, unknown>)[TW.Name] ===
        "string" &&
      !(
        (value as Record<string | symbol, unknown>)[TW.Name] as string
      ).includes("::")
    ) {
      scope[qualifyEventName(actorName, key)] = scopedValue;
    }
  };

  for (const step of steps) {
    if (
      step !== null &&
      typeof step === "object" &&
      (step as Record<symbol, unknown>)[TW.ActorScope] === true
    ) {
      continue;
    }

    if (typeof step === "function" && TW.Name in step) {
      const key = String(step[TW.Name as keyof typeof step]);
      const value = step.call(scope);
      if (
        value !== null &&
        typeof value === "object" &&
        "then" in value &&
        typeof (value as { then?: unknown }).then === "function"
      ) {
        throw new Error("Actor.scope steps must resolve synchronously");
      }
      collectEntry(key, value);
    } else if (step !== null && typeof step === "object") {
      for (const key of Object.keys(step as object)) {
        const value = (step as Record<string, unknown>)[key];
        collectEntry(key, value);
      }
    }
  }

  return scope;
}

function createBehavior(
  actorName: string,
  initialScope: Record<string, unknown>,
  resolveInitialScope: () => Promise<Record<string, unknown>> = async () =>
    initialScope
): Behavior<any> {
  let logger: ConsoleLike = console;
  let behaviorScope: Record<string, unknown> = {};
  const pendingBehaviorScopes: Promise<Record<string, unknown>>[] = [];

  function tap<G extends AsyncGenerator<unknown, unknown>>(gen: G): G {
    return tapWith(gen, dispatch(logger)) as G;
  }

  const currentInitialScope = () =>
    mergeActorScope(initialScope, behaviorScope);

  async function resolveBehaviorScope() {
    let resolved = await resolveInitialScope();
    if (Reflect.ownKeys(behaviorScope).length > 0) {
      resolved = mergeActorScope(resolved, behaviorScope);
    }
    if (pendingBehaviorScopes.length > 0) {
      const scopes = await Promise.all(pendingBehaviorScopes);
      resolved = scopes.reduce(mergeActorScope, resolved);
    }
    return resolved;
  }

  function applyScopedUse(
    plugin: unknown,
    applyScope: (scope: Record<string, unknown>) => void,
    applyPendingScope: (scope: Promise<Record<string, unknown>>) => void
  ) {
    if (isLoggerConfig(plugin)) {
      logger = plugin.target;
      return;
    }
    if (isPromiseLike(plugin)) {
      applyPendingScope(Promise.resolve(plugin).then(collectPluginScope));
      return;
    }

    const incoming = collectPluginScope(plugin);
    if (Reflect.ownKeys(incoming).length > 0) applyScope(incoming);
  }

  const self = {
    use(...plugins: unknown[]) {
      for (const plugin of plugins) {
        applyScopedUse(
          plugin,
          (incoming) => {
            behaviorScope = mergeActorScope(behaviorScope, incoming);
          },
          (incoming) => {
            pendingBehaviorScopes.push(incoming);
          }
        );
      }
      return self;
    },
    service(config: unknown) {
      return createService(actorName, config, currentInitialScope());
    },
    on(behaviorInput: unknown, config?: unknown, schema?: unknown) {
      const eventKind = isEventKind(behaviorInput) ? behaviorInput : null;
      const traitEvent = getTraitEventName(behaviorInput);
      const traitMethod = getTraitMethodName(behaviorInput);
      const behavior =
        eventKind !== null && typeof eventKind[TW.Name] === "string"
          ? eventKind[TW.Name]
          : traitEvent !== null
          ? traitEvent
          : traitMethod !== null
          ? traitMethod
          : String(behaviorInput);
      let actionName: string;
      let traitMeta: string | null = null;
      let eventMeta: string | null = null;
      let eventCommand: string | null = null;
      let actionScope: Record<string, unknown> = {};
      const pendingActionScopes: Promise<Record<string, unknown>>[] = [];

      const initialScopeAtOn =
        eventKind !== null
          ? mergeActorScope(currentInitialScope(), collectEvents(eventKind))
          : currentInitialScope();
      const scopedBehavior = initialScopeAtOn[behavior];
      const isScopedEvent =
        scopedBehavior !== null &&
        typeof scopedBehavior === "object" &&
        "emit" in scopedBehavior;
      const scopedEventCommand = isScopedEvent
        ? getEventCommand(scopedBehavior)
        : null;
      const eventKindCommand =
        eventKind !== null ? getEventCommand(eventKind) : null;
      const eventInputSchema = (eventKind ??
        (isScopedEvent
          ? (scopedBehavior as Record<string | symbol, unknown>)
          : null))?.[TW.InputSchema];
      if (traitEvent !== null && !isScopedEvent) {
        // Trait event: VoiceCall.VoiceCall → actionName = "onVoiceCall"
        actionName = eventHandlerName(traitEvent);
        eventMeta = traitEvent;
      } else if (traitMethod !== null && !isScopedEvent) {
        // Trait method: Logger.log → actionName = "log", traitMeta = "::log"
        actionName = toCamelCaseName(traitMethod.slice(2));
        traitMeta = traitMethod;
      } else if (behavior === "Command") {
        actionName = String(config);
      } else if (behavior === "Schedule") {
        actionName = "onSchedule";
      } else if (HTTP_METHODS.has(behavior)) {
        actionName = behavior;
      } else {
        eventCommand = eventKindCommand ?? scopedEventCommand;
        actionName = eventCommand ?? eventHandlerName(behavior);
        eventMeta = behavior;
      }

      let eventName = qualifyActionName(actorName, actionName);
      const mod = makeBehaviorMod(behavior, config, schema);
      let actionMeta: Record<string, unknown> | null =
        behavior === "Schedule"
          ? {
              schedule: normalizeScheduleDefinition(config),
            }
          : null;

      async function resolveActionScope() {
        let resolved = await resolveBehaviorScope();
        if (Reflect.ownKeys(actionScope).length > 0) {
          resolved = mergeActorScope(resolved, actionScope);
        }
        if (pendingActionScopes.length > 0) {
          const scopes = await Promise.all(pendingActionScopes);
          resolved = scopes.reduce(mergeActorScope, resolved);
        }
        return resolved;
      }

      function useActionPlugin(plugin: unknown) {
        applyScopedUse(
          plugin,
          (incoming) => {
            actionScope = mergeActorScope(actionScope, incoming);
          },
          (incoming) => {
            pendingActionScopes.push(incoming);
          }
        );
      }

      function createAction(
        inputMode: "first" | "args",
        handlers: unknown[],
        inputSchema?: unknown
      ) {
        async function actionRunCtx(
          context: TW.ActionContext,
          ...args: unknown[]
        ) {
          const runContext = normalizeActionContext(context);
          const resolvedInitialScope = await resolveActionScope();
          const { args: modArgs, scope: behaviorScope } = mod(args);
          const runtimeArgs = wrapUnionInput(modArgs, inputSchema);
          const extra = mergeActorScope(
            mergeActorScope(resolvedInitialScope, behaviorScope),
            runContext as Record<string, unknown>
          );
          const gen = tap(
            unwrapStreamEvents(
              runAction(
                eventName,
                buildScope(inputMode, runtimeArgs, extra),
                handlers
              )
            )
          );
          let item = await gen.next();
          while (!item.done) item = await gen.next();
          return item.value;
        }

        async function actionRun(...args: unknown[]) {
          return actionRunCtx({}, ...args);
        }

        async function consume(...args: unknown[]) {
          return actionRun(...args);
        }

        async function* rawStreamCtx(
          context: TW.ActionContext,
          ...args: unknown[]
        ) {
          const runContext = normalizeActionContext(context);
          const resolvedInitialScope = await resolveActionScope();
          const { args: modArgs, scope: behaviorScope } = mod(args);
          const runtimeArgs = wrapUnionInput(modArgs, inputSchema);
          const extra = mergeActorScope(
            mergeActorScope(resolvedInitialScope, behaviorScope),
            runContext as Record<string, unknown>
          );
          return yield* runAction(
            eventName,
            buildScope(inputMode, runtimeArgs, extra),
            handlers
          );
        }

        async function* rawStream(...args: unknown[]) {
          return yield* rawStreamCtx({}, ...args);
        }

        function streamCtx(context: TW.ActionContext, ...args: unknown[]) {
          return tap(unwrapStreamEvents(rawStreamCtx(context, ...args)));
        }

        function stream(...args: unknown[]) {
          return streamCtx({}, ...args);
        }

        function loggedRawStream(...args: unknown[]) {
          return tapRawStreamWith(rawStream(...args), dispatch(logger));
        }

        function ctx(context: TW.ActionContext = {}) {
          const boundContext = normalizeActionContext(context);
          return {
            run(...args: unknown[]) {
              return actionRunCtx(boundContext, ...args);
            },
            stream(...args: unknown[]) {
              return streamCtx(boundContext, ...args);
            },
          };
        }

        const resolveMeta = () =>
          traitMeta !== null || eventMeta !== null || actionMeta !== null
            ? {
                ...(traitMeta !== null ? { trait: traitMeta } : {}),
                ...(eventMeta !== null ? { event: eventMeta } : {}),
                ...(eventCommand !== null ? { command: eventCommand } : {}),
                ...actionMeta,
              }
            : null;
        const action = Object.assign(consume, {
          [TW.Name]: eventName,
          run: actionRun,
          stream,
          ctx,
          [TW.Meta]: resolveMeta(),
          [TW.InputSchema]: inputSchema,
          [RawStreamTag]: rawStream,
          [RawLoggedStreamTag]: loggedRawStream,
        });
        const result = {
          [actionName]: action,
          meta(meta: Record<string, unknown>) {
            actionMeta = {
              ...actionMeta,
              ...resolveMetaExpressionBuilders(meta),
            };
            action[TW.Meta] = resolveMeta();
            return result;
          },
        };

        return result;
      }

      const makeBody = (
        inputMode: "first" | "args",
        inputSchema?: unknown
      ) => ({
        addStateCommand(
          alias: string,
          commands: Record<string, Record<string, string>>
        ) {
          const currentCommands =
            actionMeta?.stateCommands !== null &&
            typeof actionMeta?.stateCommands === "object"
              ? (actionMeta.stateCommands as Record<string, unknown>)
              : {};
          actionMeta = {
            ...actionMeta,
            stateCommands: {
              ...currentCommands,
              [alias]: commands,
            },
          };
          return this;
        },
        use(...plugins: unknown[]) {
          for (const plugin of plugins) useActionPlugin(plugin);
          return this;
        },
        run(...handlers: unknown[]) {
          return createAction(inputMode, handlers, inputSchema);
        },
      });

      const base = {
        sig() {
          return makeBody("args");
        },
        input(...inputSchema: unknown[]) {
          return makeBody(
            "first",
            inputSchema.length <= 1 ? inputSchema[0] : inputSchema
          );
        },
        use(...plugins: unknown[]) {
          for (const plugin of plugins) useActionPlugin(plugin);
          return this;
        },
        run(...handlers: unknown[]) {
          return createAction("first", handlers, eventInputSchema);
        },
      };

      if (behavior === "Schedule") {
        const scheduled = {
          ...base,
          command(cmdName: string) {
            actionName = cmdName;
            eventName = qualifyActionName(actorName, cmdName);
            return scheduled;
          },
        };
        return scheduled as any;
      }

      if (HTTP_METHODS.has(behavior) && schema) {
        return {
          ...base,
          command(cmdName: string) {
            let commandMeta: Record<string, unknown> = {};
            return {
              use(...plugins: unknown[]) {
                for (const plugin of plugins) useActionPlugin(plugin);
                return this;
              },
              run(...handlers: unknown[]) {
                const qualifiedCmdName = qualifyActionName(actorName, cmdName);

                async function* rawCmdStreamCtx(
                  context: TW.ActionContext,
                  flatInput: unknown
                ) {
                  const runContext = normalizeActionContext(context);
                  const resolvedInitialScope = await resolveActionScope();
                  return yield* runAction(
                    qualifiedCmdName,
                    buildScope(
                      "first",
                      [flatInput],
                      mergeActorScope(
                        resolvedInitialScope,
                        runContext as Record<string, unknown>
                      )
                    ),
                    handlers
                  );
                }

                async function* rawCmdStream(flatInput: unknown) {
                  return yield* rawCmdStreamCtx({}, flatInput);
                }

                function cmdStreamCtx(
                  context: TW.ActionContext,
                  flatInput: unknown
                ) {
                  return tap(
                    unwrapStreamEvents(rawCmdStreamCtx(context, flatInput))
                  );
                }

                function cmdStream(flatInput: unknown) {
                  return cmdStreamCtx({}, flatInput);
                }

                function loggedRawCmdStream(flatInput: unknown) {
                  return tapRawStreamWith(
                    rawCmdStream(flatInput),
                    dispatch(logger)
                  );
                }

                async function cmdRunCtx(
                  context: TW.ActionContext,
                  flatInput: unknown
                ) {
                  const gen = cmdStreamCtx(context, flatInput);
                  let item = await gen.next();
                  while (!item.done) item = await gen.next();
                  return item.value;
                }

                async function cmdRun(flatInput: unknown) {
                  return cmdRunCtx({}, flatInput);
                }

                async function cmdConsume(flatInput: unknown) {
                  return cmdRun(flatInput);
                }

                function ctx(context: TW.ActionContext = {}) {
                  const boundContext = normalizeActionContext(context);
                  return {
                    run(flatInput: unknown) {
                      return cmdRunCtx(boundContext, flatInput);
                    },
                    stream(flatInput: unknown) {
                      return cmdStreamCtx(boundContext, flatInput);
                    },
                  };
                }

                const resolveMeta = () => ({
                  route: [
                    behavior,
                    config,
                    {
                      ...(schema as Record<string, unknown>),
                      ...commandMeta,
                    },
                  ],
                });
                const action = Object.assign(cmdConsume, {
                  [TW.Name]: qualifiedCmdName,
                  [TW.Meta]: resolveMeta(),
                  [TW.InputSchema]: schema,
                  run: cmdRun,
                  stream: cmdStream,
                  ctx,
                  [RawStreamTag]: rawCmdStream,
                  [RawLoggedStreamTag]: loggedRawCmdStream,
                });
                const result = {
                  [cmdName]: action,
                  meta(meta: Record<string, unknown>) {
                    commandMeta = {
                      ...commandMeta,
                      ...resolveMetaExpressionBuilders(meta),
                    };
                    action[TW.Meta] = resolveMeta();
                    return this;
                  },
                };

                return result;
              },
            };
          },
        } as any;
      }

      return base as any;
    },
  };

  return self as unknown as Behavior<any>;
}

/**
 * The full return type of Actor(), including:
 *  - `scope` / `actor` — standard builder API
 *  - `use(plugin)` — inject action scope from an object or dynamic import
 *  - all `Behavior` methods (except `use`) so `.on()` can be called fluently
 *    directly on the builder without needing an explicit `actor()` call
 */
export type ActorBuilderResult<
  Name extends string,
  Ctx extends Record<any, any>
> = {
  scope: Steps<Ctx, ScopeResultKind>;
  use<const Plugins extends readonly unknown[]>(
    ...plugins: Plugins
  ): ActorBuilderResult<Name, AddActionsToCtxMany<Ctx, Plugins>>;
} & {
  actor: ActorFactory<Ctx>;
} & Omit<Behavior<Ctx>, "use">;

// ── Actor builder runtime ─────────────────────────────────────────────────────

function isLoggerConfig(value: unknown): value is LoggerConfig {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as Record<string | symbol, unknown>)[TW.Type] === "Logger" &&
    "target" in value
  );
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function exposeAction(plugin: unknown) {
  if (
    typeof plugin === "function" &&
    "run" in plugin &&
    typeof (plugin as { run?: unknown }).run === "function"
  ) {
    const run = (...args: unknown[]) =>
      (plugin as { run: (...args: unknown[]) => unknown }).run(...args);
    if (
      "ctx" in plugin &&
      typeof (plugin as { ctx?: unknown }).ctx === "function"
    ) {
      Object.defineProperty(run, ContextualActionTag, {
        value: (context: ExecutionContext, ...args: unknown[]) =>
          (
            plugin as {
              ctx: (context: ExecutionContext) => { run: Function };
            }
          )
            .ctx(context)
            .run(...args),
      });
    }
    return run;
  }

  return typeof plugin === "function" &&
    RawStreamTag in plugin &&
    typeof (plugin as { [RawStreamTag]?: unknown })[RawStreamTag] === "function"
    ? (plugin as { [RawStreamTag]: (...args: unknown[]) => unknown })[
        RawStreamTag
      ]
    : typeof plugin === "function" &&
      "stream" in plugin &&
      typeof (plugin as { stream?: unknown }).stream === "function"
    ? (plugin as { stream: (...args: unknown[]) => unknown }).stream
    : plugin;
}

function collectAction(plugin: unknown): Record<string, unknown> {
  const fullName: unknown = (plugin as any)[TW.Name];
  if (typeof fullName !== "string") return {};

  const qualified = splitQualifiedActionName(fullName);
  const exposed = exposeAction(plugin);
  if (qualified === null) return { [fullName]: exposed };

  const service =
    qualified.service.charAt(0).toLowerCase() + qualified.service.slice(1);
  const method = qualified.method;

  return { [service]: { [method]: exposed } };
}

function mergeActions(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };

  for (const [key, value] of Object.entries(incoming)) {
    if (typeof value === "function") {
      merged[key] = value;
    } else {
      merged[key] = {
        ...(merged[key] as Record<string, unknown> | undefined),
        ...(value as Record<string, unknown>),
      };
    }
  }

  return merged;
}

function collectActions(plugin: unknown): Record<string, unknown> {
  return collectActionsInner(plugin, new WeakSet<object>());
}

function collectActionsInner(
  plugin: unknown,
  visited: WeakSet<object>
): Record<string, unknown> {
  if (typeof plugin === "function") return collectAction(plugin);
  if (plugin === null || typeof plugin !== "object") return {};
  if (visited.has(plugin)) return {};
  visited.add(plugin);

  let incoming: Record<string, unknown> = {};
  for (const value of Object.values(plugin as Record<string, unknown>)) {
    incoming = mergeActions(incoming, collectActionsInner(value, visited));
  }

  return incoming;
}

function serviceActionName(action: unknown): string | null {
  if (
    action !== null &&
    (typeof action === "object" || typeof action === "function") &&
    TW.Name in Object(action)
  ) {
    const fullName = (action as Record<string | symbol, unknown>)[TW.Name];
    if (typeof fullName === "string") {
      const qualified = splitQualifiedActionName(fullName);
      return qualified?.method ?? fullName;
    }
  }

  return typeof action === "function" && action.name ? action.name : null;
}

function isServiceListenerAction(action: unknown): boolean {
  if (
    action === null ||
    (typeof action !== "object" && typeof action !== "function") ||
    !(TW.Meta in Object(action))
  ) {
    return false;
  }

  const meta = (action as Record<string | symbol, unknown>)[TW.Meta];
  return (
    meta !== null &&
    typeof meta === "object" &&
    typeof (meta as Record<string, unknown>).event === "string" &&
    typeof (meta as Record<string, unknown>).command !== "string"
  );
}

function createService(
  actorName: string,
  config: unknown,
  scope: Record<string, unknown>
): Record<string, unknown> {
  if (
    config !== null &&
    typeof config === "object" &&
    ("public" in config || "listeners" in config)
  ) {
    throw new Error(
      "service() accepts actions directly: service({ hello, onNewEmail }). The public/listeners keys are no longer supported."
    );
  }

  const configuredActions =
    config !== null && typeof config === "object"
      ? Object.values(config as Record<string, unknown>)
      : [];
  const publicActions = configuredActions.filter(
    (action) => !isServiceListenerAction(action)
  );
  const listenerActions = configuredActions.filter(isServiceListenerAction);
  const service: Record<string | symbol, unknown> = {
    [TW.Name]: actorName,
    [TW.Scope]: collectOwnedEvents(actorName, scope),
    [TW.States]: collectOwnedStates(scope),
  };

  if (listenerActions.length > 0) {
    Object.defineProperty(service, TW.Listeners, {
      value: listenerActions,
      enumerable: false,
    });
  }

  for (const action of publicActions) {
    const name = serviceActionName(action);
    if (name) {
      service[name] = action;
    }
  }

  return { [capitalCaseName(actorName)]: service };
}

function collectOwnedStates(
  scope: Record<string, unknown>
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(scope).filter(([, value]) => {
      if (value === null || typeof value !== "object") return false;
      return (value as Record<symbol, unknown>)[TW.State] === "state";
    })
  ) as Record<string, Record<string, unknown>>;
}

function isEventKind(
  value: unknown
): value is Record<string | symbol, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    "emit" in value &&
    TW.Name in value
  );
}

function getTraitMethodName(value: unknown): `::${string}` | null {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function") ||
    !(TW.Name in Object(value))
  ) {
    return null;
  }

  const name = (value as Record<string | symbol, unknown>)[TW.Name];
  return typeof name === "string" && name.startsWith("::")
    ? (name as `::${string}`)
    : null;
}

function getTraitEventName(value: unknown): `::${string}` | null {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function") ||
    !(TW.Meta in Object(value))
  ) {
    return null;
  }

  const meta = (value as Record<string | symbol, unknown>)[TW.Meta];
  const event =
    meta !== null && typeof meta === "object"
      ? (meta as Record<string, unknown>).event
      : null;

  return typeof event === "string" && event.startsWith("::")
    ? (event as `::${string}`)
    : null;
}

function getEventCommand(value: unknown): string | null {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function") ||
    !(TW.Meta in Object(value))
  ) {
    return null;
  }

  const meta = (value as Record<string | symbol, unknown>)[TW.Meta];
  const command =
    meta !== null && typeof meta === "object"
      ? (meta as Record<string, unknown>).command
      : null;

  return typeof command === "string" ? command : null;
}

function eventScopeKey(eventName: string): string {
  return eventName;
}

function hasEventExports(value: unknown): value is { events: unknown } {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "events" in value
  );
}

function collectOwnedEvents(
  actorName: string,
  scope: Record<string, unknown>
): Record<string, unknown> {
  const events: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(scope)) {
    if (!isEventKind(value)) continue;
    const eventName = value[TW.Name];
    if (
      typeof eventName === "string" &&
      eventName.startsWith(`${actorName}::`) &&
      !key.includes("::")
    ) {
      events[key] = value;
    }
  }
  return events;
}

function collectEvents(plugin: unknown): Record<string, unknown> {
  if (isEventKind(plugin)) {
    const eventName = plugin[TW.Name];
    return typeof eventName === "string"
      ? { [eventScopeKey(eventName)]: plugin }
      : {};
  }
  if (plugin !== null && typeof plugin === "object" && TW.Scope in plugin) {
    return collectEvents(
      (plugin as Record<string | symbol, unknown>)[TW.Scope]
    );
  }
  if (hasEventExports(plugin)) {
    return collectEvents(plugin.events);
  }
  if (plugin === null || typeof plugin !== "object") return {};

  const incoming: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(
    plugin as Record<string, unknown>
  )) {
    if (!isEventKind(value)) continue;
    const eventName = value[TW.Name];
    incoming[key] = value;
    if (typeof eventName === "string") {
      incoming[eventScopeKey(eventName)] = value;
    }
  }
  return incoming;
}

function collectPluginScope(plugin: unknown): Record<string, unknown> {
  const actions = collectActions(plugin);
  const declaredScope =
    plugin !== null &&
    typeof plugin === "object" &&
    TW.Scope in plugin &&
    (plugin as Record<symbol, unknown>)[TW.Scope] !== null &&
    typeof (plugin as Record<symbol, unknown>)[TW.Scope] === "object"
      ? ((plugin as Record<symbol, unknown>)[TW.Scope] as Record<
          string,
          unknown
        >)
      : {};
  return {
    ...declaredScope,
    ...collectEvents(plugin),
    ...(Object.keys(actions).length > 0 ? { actions } : {}),
  };
}

function mergeActorScope(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const { actions: incomingActions, ...incomingScope } = incoming;
  const existingProviders = (existing as Record<symbol, unknown>)[TW.Provider];
  const incomingProviders = (incoming as Record<symbol, unknown>)[TW.Provider];
  const next: Record<string, unknown> = {
    ...existing,
    ...incomingScope,
  };

  if (incomingProviders !== null && typeof incomingProviders === "object") {
    (next as Record<symbol, unknown>)[TW.Provider] = {
      ...(existingProviders !== null && typeof existingProviders === "object"
        ? existingProviders
        : {}),
      ...incomingProviders,
    };
  }

  if (
    incomingActions !== null &&
    typeof incomingActions === "object" &&
    Object.keys(incomingActions as Record<string, unknown>).length > 0
  ) {
    next.actions = mergeActions(
      (existing.actions as Record<string, unknown> | undefined) ?? {},
      incomingActions as Record<string, unknown>
    );
  }

  return next;
}

function makeActorBuilder(
  actorName: string,
  actorScope: Record<string, unknown>,
  pendingPlugins: Promise<Record<string, unknown>>[] = []
): any {
  // Lazily-created behavior for fluid `.on()` calls directly on the builder.
  let _behavior: ReturnType<typeof createBehavior> | null = null;
  const resolveActorScope = async () => {
    if (pendingPlugins.length === 0) return actorScope;

    const pluginScopes = await Promise.all(pendingPlugins);
    return pluginScopes.reduce(mergeActorScope, actorScope);
  };

  const getBehavior = () => {
    if (!_behavior)
      _behavior = createBehavior(
        actorName,
        {
          ...builtInEventScope,
          ...actorScope,
        },
        async () => ({
          ...builtInEventScope,
          ...(await resolveActorScope()),
        })
      );
    return _behavior;
  };

  const createActorFactory = (
    behaviorScope: Record<string, unknown>,
    resolveBehaviorScope: () => Promise<Record<string, unknown>>,
    eventScope: () => Record<string, unknown>
  ) =>
    Object.assign(
      () => createBehavior(actorName, behaviorScope, resolveBehaviorScope),
      {
        get events() {
          return collectOwnedEvents(actorName, eventScope());
        },
      }
    );

  const defaultFactory = createActorFactory(
    { ...builtInEventScope, ...actorScope },
    async () => ({
      ...builtInEventScope,
      ...(await resolveActorScope()),
    }),
    () => actorScope
  );

  return {
    scope(...steps: unknown[]) {
      const definedScope = collectScope(steps, actorName);
      const initialScope = {
        ...builtInEventScope,
        ...actorScope,
        ...definedScope,
      };
      const factory = createActorFactory(
        initialScope,
        async () => ({
          ...builtInEventScope,
          ...(await resolveActorScope()),
          ...collectScope(steps, actorName),
        }),
        () => definedScope
      );
      return {
        actor: factory,
      } as any;
    },

    use(...plugins: unknown[]): any {
      let nextScope = actorScope;
      const nextPending = [...pendingPlugins];
      for (const plugin of plugins) {
        if (isPromiseLike(plugin)) {
          nextPending.push(Promise.resolve(plugin).then(collectPluginScope));
          continue;
        }

        const incoming = collectPluginScope(plugin);
        if (Reflect.ownKeys(incoming).length > 0) {
          nextScope = mergeActorScope(nextScope, incoming);
        }
      }
      return makeActorBuilder(actorName, nextScope, nextPending);
    },

    // Fluent `.on()` — delegates to a lazily-created Behavior so callers
    // can write `Actor("X").use(plugin).on("Command", "foo")` without an
    // explicit `actor()` factory call.
    on(...args: unknown[]) {
      return (getBehavior() as any).on(...args);
    },
    service(...args: unknown[]) {
      return (getBehavior() as any).service(...args);
    },

    actor: defaultFactory,
  };
}

export const Actor = <
  const Name extends string,
  const Ctx extends Record<any, any> = {
    name: Name;
    model: "gpt5";
    scope: BuiltInEventScope & {
      thread: {
        sender: {
          name: string;
        };
        reply(msg: string): boolean;
      };
      actions: {
        generateText: (params: { model: "gpt5"; prompt: string }) => string;
      };
    };
  }
>(
  name: PascalCase<Name>
): ActorBuilderResult<Name, Ctx> => {
  return makeActorBuilder(name as string, {}) as any;
};
