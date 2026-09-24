import { distill, type } from "arktype";
import { type Constructor, type array, type conform } from "@ark/util";
import type { Morph, NodeSelector, Predicate, TypeMeta } from "@ark/schema";
import {
  Apply,
  Append,
  ActionCtx,
  ValidateTrigger,
  InferTriggerScope,
  Pretty,
  CamelCase,
  AddActionsToCtxMany,
  DeepWriteable,
  QualifiedActionName,
  isUnionSchema,
  splitQualifiedActionName,
} from "../helpers";
import type { Steps, ActionResultKind } from "../steps";
import { TW } from "../core";
import {
  dispatch,
  type ConsoleLike,
  type DispatchFn,
  type LoggerConfig,
  Signal,
  Trace,
  Wind,
} from "@taskwish/wind";
import { type InferTypeConfig } from "../use";
import { $ as expressionRoot } from "@taskwish/expr";
import {
  ActionMeta,
  ResolveActionMeta,
  ValidateActionMeta,
} from "./meta";

type ArgTwoOperator = "[]" | "&" | "|" | "|>" | ":" | "=>" | "@";
type IndexZeroOperator = "keyof" | "instanceof" | "===";
type TupleInfixOperator = "&" | "|" | "|>" | ":" | "=>" | "@" | "=";

type CommandInputScope<Input> = {
  input: Input;
  event: Signal<"Command", Input>;
};

type ArkTypeInfer<T> = T extends { infer: infer Inferred } ? Inferred : T;

type NormalizeArkVoid<T> = T extends "void" ? "undefined" : T;

type NormalizeArkTuple<T extends readonly unknown[]> = {
  [K in keyof T]: NormalizeArkVoid<T[K]>;
};

type IsUnion<Type, Whole = Type> = Type extends unknown
  ? [Whole] extends [Type]
    ? false
    : true
  : never;

type MarkUnionInput<Input> = true extends IsUnion<Input>
  ? TW.Union<Input>
  : Input;

type ValidateArkOperand<T, Scope> = T extends "void"
  ? T
  : type.validate<T, Scope>;

type InputActionBody<
  Name extends string,
  Ctx extends Record<any, any>,
  Input
> = ActionBody<
  Name,
  {
    name: Ctx["name"];
    service: Ctx["service"];
    scope: CommandInputScope<Input> & Ctx["scope"];
    step: {
      name: "launchApp" | StepName;
      map: { launchApp: string };
    };
    steps: [];
    plugins: Ctx["plugins"];
    meta: "meta" extends keyof Ctx ? Ctx["meta"] : null;
  }
>;

type AppendPlugin<Ctx extends Record<any, any>, Plugin> = {
  name: Ctx["name"];
  service: Ctx["service"];
  steps: Ctx["steps"];
  scope: Ctx["scope"];
  last: Ctx["last"];
  plugins: Append<Ctx["plugins"], Plugin>;
};

type StateCommandInput<Ctx extends Record<any, any>> = Ctx["scope"] extends {
  input: infer Input extends Record<string, unknown>;
}
  ? Input
  : {};

type StateCommandItem<Ctx extends Record<any, any>> = Ctx["scope"] extends {
  state: infer State;
}
  ? {
      [Key in keyof State]: State[Key] extends readonly (infer Item)[]
        ? Item
        : never;
    }[keyof State]
  : never;

type StateCommandPathEntry<
  Value,
  Prefix extends string = "",
  Depth extends unknown[] = []
> = Depth["length"] extends 4
  ? never
  : Value extends object
  ? {
      [Key in keyof Value & string]: NonNullable<Value[Key]> extends object
        ? NonNullable<Value[Key]> extends readonly unknown[]
          ? never
          : StateCommandPathEntry<
              NonNullable<Value[Key]>,
              Prefix extends "" ? Key : `${Prefix}.${Key}`,
              [...Depth, unknown]
            >
        : {
            path: Prefix extends "" ? Key : `${Prefix}.${Key}`;
            value: Value[Key];
          };
    }[keyof Value & string]
  : never;

type StateCommandPathFor<Value, Expected> =
  StateCommandPathEntry<Value> extends infer Entry
    ? Entry extends { path: infer Path extends string; value: infer PathValue }
      ? NonNullable<PathValue> extends NonNullable<Expected>
        ? Path
        : never
      : never
    : never;

type StateCommandPayload<Ctx extends Record<any, any>, Alias extends string> = {
  [Key in keyof StateCommandInput<Ctx>]: `${Alias}.${StateCommandPathFor<
    StateCommandItem<Ctx>,
    StateCommandInput<Ctx>[Key]
  >}`;
};

type StateCommandCondition<Ctx extends Record<any, any>> =
  StateCommandItem<Ctx> extends infer Item
    ? Item extends Record<string, unknown>
      ? Partial<Item>
      : never
    : never;

type StateCommandDefinition<
  Ctx extends Record<any, any>,
  Alias extends string
> =
  | StateCommandPayload<Ctx, Alias>
  | {
      input: StateCommandPayload<Ctx, Alias>;
      visible: StateCommandCondition<Ctx>;
    };

type ActionBody<
  Name extends string,
  Ctx extends Record<any, any>
> = TW.Contextual<Ctx> & {
  addStateCommand<
    const Alias extends string,
    const Commands extends Record<string, StateCommandDefinition<Ctx, Alias>>
  >(
    alias: Alias,
    commands: Commands
  ): ActionBody<Name, Ctx>;
  use<const Config extends LoggerConfig>(
    config: Config
  ): ActionBody<Name, AppendPlugin<Ctx, Config>>;
  use<const F extends string | undefined>(
    config: InferTypeConfig<F>
  ): ActionBody<Name, AppendPlugin<Ctx, InferTypeConfig<F>>>;
  use<const Plugins extends readonly unknown[]>(
    ...plugins: Plugins
  ): ActionBody<Name, AddActionsToCtxMany<Ctx, Plugins>>;
  run: Steps<Ctx, ActionResultKind>;
};

type SignatureInput<
  Signature,
  Ctx extends Record<any, any>
> = Signature extends (...args: any) => any
  ? Parameters<Signature>
  : Signature extends TW.Handler
  ? Parameters<Apply<Signature, Ctx>>
  : never;

type SignatureOutput<
  Signature,
  Ctx extends Record<any, any>
> = Signature extends (...args: any) => any
  ? RuntimeResult<ReturnType<Signature>>
  : Signature extends TW.Handler
  ? RuntimeResult<ReturnType<Apply<Signature, Ctx>>>
  : never;

type RuntimeResult<Result> = Awaited<Result> extends AsyncGenerator<
  any,
  infer Return,
  any
>
  ? Awaited<Return>
  : Result extends Generator<any, infer Return, any>
  ? Return
  : Result;

type RuntimeHandler<Handler extends (...args: any[]) => any> = Awaited<
  ReturnType<Handler>
> extends AsyncGenerator<any, any, any>
  ? (
      ...args: Parameters<Handler>
    ) => Promise<RuntimeResult<ReturnType<Handler>>>
  : Handler;

type ActionNameFor<
  Ctx extends Record<any, any>,
  Name extends string
> = "service" extends keyof Ctx
  ? QualifiedActionName<Ctx["service"] & string, Name>
  : Name;

type SignatureMetaContext<Signature, Ctx extends Record<any, any>> = Omit<
  Ctx,
  "scope"
> & {
  scope: Pretty<Record<"input", SignatureInput<Signature, Ctx>> & Ctx["scope"]>;
};

type SignatureResult<
  Name extends string,
  Ctx extends Record<any, any>,
  Signature,
  Meta = null
> = {
  [key in Name]: Signature extends (...args: any) => any
    ? TW.Action<
        ActionNameFor<Ctx, Name>,
        RuntimeHandler<Signature>,
        TW.ActionCtxMeta<Meta, ActionCtx<Ctx["scope"]>>
      >
    : Signature extends TW.Handler
    ? TW.Action<
        ActionNameFor<Ctx, Name>,
        RuntimeHandler<Apply<Signature, Ctx>>,
        TW.ActionCtxMeta<
          Meta extends null
            ? Record<"handler", Signature>
            : Meta & Record<"handler", Signature>,
          ActionCtx<Ctx["scope"]>
        >
      >
    : never;
} & {
  meta<
    const NextMeta extends ActionMeta<
      SignatureMetaContext<Signature, Ctx>,
      SignatureOutput<Signature, Ctx>
    >
  >(
    meta: ValidateActionMeta<
      NextMeta,
      SignatureMetaContext<Signature, Ctx>,
      SignatureOutput<Signature, Ctx>
    >
  ): SignatureResult<
    Name,
    Ctx,
    Signature,
    DeepWriteable<ResolveActionMeta<NextMeta>>
  >;
};

type SignatureBody<
  Name extends string,
  Ctx extends Record<any, any>,
  Signature
> = {
  use<const Config extends LoggerConfig>(
    config: Config
  ): SignatureBody<Name, AppendPlugin<Ctx, Config>, Signature>;
  use<const F extends string | undefined>(
    config: InferTypeConfig<F>
  ): SignatureBody<Name, AppendPlugin<Ctx, InferTypeConfig<F>>, Signature>;
  use<const Plugins extends readonly unknown[]>(
    ...plugins: Plugins
  ): SignatureBody<Name, AddActionsToCtxMany<Ctx, Plugins>, Signature>;
  run<
    const Handler extends (
      this: TW.Scope<
        Pretty<
          Record<
            "input",
            Signature extends (...args: any) => any
              ? Parameters<Signature>
              : Signature extends TW.Handler
              ? Parameters<Apply<Signature, Ctx>>
              : never
          > &
            Ctx["scope"]
        >
      >
    ) => Signature extends (...args: any) => any
      ? ReturnType<Signature>
      : Signature extends TW.Handler
      ? ReturnType<Apply<Signature, Ctx>>
      : never
  >(
    run: Handler
  ): SignatureResult<Name, Ctx, Signature>;
};

type StepName = string & {};

export interface ActionFactory<
  Name extends string,
  Ctx extends Record<any, any> = {
    name: Name;
    model: "gpt5";
    scope: {
      thread: {
        sender: {
          name: string;
        };
        reply(msg: string): boolean;
      };
      actions: {
        generateText: (params: {
          model: "gpt5";
          prompt: string;
        }) => AsyncGenerator<
          Trace<"generateText", { input: { model: "gpt5"; prompt: string } }>,
          Promise<string>,
          unknown
        >;
      };
    };
    steps: [];
    plugins: [];
  }
> {
  use<const Config extends LoggerConfig>(
    config: Config
  ): ActionFactory<Name, AppendPlugin<Ctx, Config>>;
  use<const F extends string | undefined>(
    config: InferTypeConfig<F>
  ): ActionFactory<Name, AppendPlugin<Ctx, InferTypeConfig<F>>>;
  use<const Plugins extends readonly unknown[]>(
    ...plugins: Plugins
  ): ActionFactory<Name, AddActionsToCtxMany<Ctx, Plugins>>;
  sig<
    const Schema extends ((...args: any) => any) | TW.Handler
  >(): SignatureBody<Name, Ctx, Schema>;
  input<const Schema>(
    trigger?: ValidateTrigger<Schema>
  ): Schema extends ((...args: any) => any) | TW.Handler
    ? SignatureBody<Name, Ctx, Schema>
    : InputActionBody<
        Name,
        Ctx,
        MarkUnionInput<InferTriggerScope<Schema>["input"]>
      >;
  input<
    const zero,
    const one,
    const rest extends array,
    r = type.instantiate<NormalizeArkTuple<[zero, one, ...rest]>, Ctx["scope"]>
  >(
    _0: zero extends IndexZeroOperator
      ? zero
      : ValidateArkOperand<zero, Ctx["scope"]>,
    _1: zero extends "keyof"
      ? type.validate<one, Ctx["scope"]>
      : zero extends "instanceof"
      ? conform<one, Constructor>
      : zero extends "==="
      ? conform<one, unknown>
      : conform<one, ArgTwoOperator>,
    ..._2: zero extends "==="
      ? rest
      : zero extends "instanceof"
      ? conform<rest, readonly Constructor[]>
      : one extends TupleInfixOperator
      ? one extends ":"
        ? [Predicate<distill.In<type.infer<zero, Ctx["scope"]>>>]
        : one extends "=>"
        ? [Morph<distill.Out<type.infer<zero, Ctx["scope"]>>, unknown>]
        : one extends "|>"
        ? [ValidateArkOperand<rest[0], Ctx["scope"]>]
        : one extends "@"
        ? [TypeMeta.MappableInput, NodeSelector?]
        : [ValidateArkOperand<rest[0], Ctx["scope"]>]
      : []
  ): InputActionBody<Name, Ctx, MarkUnionInput<ArkTypeInfer<r>>>;
  run: Steps<Ctx, ActionResultKind>;
}

const AsyncGeneratorFunction = async function* () {}.constructor as Function;

export const RawStreamTag = Symbol.for("TW.RawStream");
export const RawLoggedStreamTag = Symbol.for("TW.RawLoggedStream");
export const ContextualActionTag = Symbol.for("TW.ContextualAction");

function isWindStream(value: unknown): value is Wind.Stream<unknown> {
  return value instanceof Wind.Stream;
}

export async function* tapWith(
  gen: AsyncGenerator<unknown, unknown>,
  log: DispatchFn
): AsyncGenerator<unknown, unknown> {
  let next = await gen.next();
  while (!next.done) {
    log(next.value);
    yield next.value;
    next = await gen.next();
  }
  return next.value;
}

export async function* tapRawStreamWith(
  gen: AsyncGenerator<unknown, unknown>,
  log: DispatchFn
): AsyncGenerator<unknown, unknown> {
  let next = await gen.next();
  while (!next.done) {
    log(isWindStream(next.value) ? next.value.data : next.value);
    yield next.value;
    next = await gen.next();
  }
  return next.value;
}

export async function* unwrapStreamEvents(
  gen: AsyncGenerator<unknown, unknown>
): AsyncGenerator<unknown, unknown> {
  let sent: unknown;

  while (true) {
    const next = await gen.next(sent);
    if (next.done) return next.value;

    const value = isWindStream(next.value) ? next.value.data : next.value;
    sent = yield value;
  }
}

export type ExecutionContext = Record<string | symbol, unknown>;

export type Scope = ExecutionContext & {
  input: unknown;
  abortSignal?: AbortSignal;
  signal<T extends string, D extends Record<string, unknown>>(
    type: T,
    data: D
  ): AsyncGenerator<Signal<T, D>, Signal<T, D>["data"], unknown>;
};

type ContextualAction = ((...args: unknown[]) => unknown) & {
  [ContextualActionTag]?: (
    context: ExecutionContext,
    ...args: unknown[]
  ) => unknown;
};

function isAbortSignal(value: unknown): value is AbortSignal {
  return value instanceof AbortSignal;
}

export function normalizeActionContext(
  context: TW.ActionContext = {}
): ExecutionContext {
  if (isAbortSignal(context)) return { abortSignal: context };

  const normalized: ExecutionContext = {};
  const contextRecord = context as Record<string | symbol, unknown>;

  for (const key of Object.keys(contextRecord)) {
    const value = contextRecord[key];
    if (value === undefined) continue;
    normalized[key] = value;
  }

  for (const key of Object.getOwnPropertySymbols(contextRecord)) {
    const value = contextRecord[key];
    if (value === undefined) continue;
    normalized[key] = value;
  }

  return normalized;
}

export function resolveMetaExpressionBuilders(
  meta: Record<string, unknown>
): Record<string, unknown> {
  const input = meta.input;
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return meta;
  }

  const resolvedInput = Object.fromEntries(
    Object.entries(input).map(([name, field]) => {
      if (field === null || typeof field !== "object" || Array.isArray(field)) {
        return [name, field];
      }

      const suggestions = (field as Record<string, unknown>).suggestions;
      if (
        suggestions === null ||
        typeof suggestions !== "object" ||
        Array.isArray(suggestions)
      ) {
        return [name, field];
      }

      const selector = (suggestions as Record<string, unknown>)["*"];
      if (typeof selector !== "function") return [name, field];

      return [
        name,
        {
          ...(field as Record<string, unknown>),
          suggestions: {
            ...(suggestions as Record<string, unknown>),
            "*": selector(expressionRoot),
          },
        },
      ];
    })
  );

  return { ...meta, input: resolvedInput };
}

// ── InferType action-step probe ───────────────────────────────────────────────

/** Sentinel property set on the fake return value inside `probeForActionCall`. */
const InferTypeActionCallTag = Symbol.for("TW.InferTypeActionCall");

type ActionCallCapture = { name: string; params: Record<string, unknown> };

/**
 * Infinite-depth proxy that tracks the property-access path.
 * In a string context (template literal) it yields `"@{path}"` so that
 * dynamic params like `` `hello ${this.input.name}` `` are captured as
 * `"hello @{input.name}"`.  In a numeric context it yields `0` so that
 * comparisons like `this.gent.length > 2` don't throw.
 */
function makeRecursiveProxy(path: string = ""): unknown {
  return new Proxy(function () {}, {
    get(_, prop) {
      if (prop === Symbol.toPrimitive) {
        return (hint: string) => (hint === "string" && path ? `@{${path}}` : 0);
      }
      if (prop === "valueOf") return () => 0;
      if (prop === "toString") return () => (path ? `@{${path}}` : "");
      const next = path ? `${path}.${String(prop)}` : String(prop);
      return makeRecursiveProxy(next);
    },
    apply() {
      return makeRecursiveProxy(path);
    },
  });
}

/**
 * Calls `fn` in a probe context where `this.actions.<name>(params)` is
 * intercepted.  Returns the captured action name + params, or `null` if the
 * handler isn't a direct action call.
 */
function probeForActionCall(fn: Function): ActionCallCapture | null {
  let captured: ActionCallCapture | null = null;

  const actionsProxy = new Proxy(
    {},
    {
      get(_, prop) {
        return (params: unknown) => {
          captured = {
            name: String(prop),
            params:
              params !== null && typeof params === "object"
                ? (params as Record<string, unknown>)
                : {},
          };
          const sentinel = Object.create(null);
          Object.defineProperty(sentinel, InferTypeActionCallTag, {
            value: true,
            enumerable: false,
          });
          return sentinel;
        };
      },
    }
  );

  const ctx = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "actions") return actionsProxy;
        return makeRecursiveProxy(String(prop));
      },
    }
  );

  try {
    const ret = fn.call(ctx);
    if (
      captured !== null &&
      ret !== null &&
      typeof ret === "object" &&
      InferTypeActionCallTag in (ret as object)
    ) {
      return captured;
    }
  } catch {
    // handler threw before/after the action call — treat as ScriptStep
  }

  return null;
}

/** Marks an AsyncGenerator returned by `self(input)` so runStep can yield* it directly. */
const SelfTag = Symbol.for("TW.SelfCall");

/** Set on ctx by the self() closure so runHandlerList can promote its name after the step. */
const SelfCalledTag = Symbol.for("TW.SelfCalled");

function isAsyncGenerator(
  value: unknown
): value is AsyncGenerator<unknown, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as AsyncGenerator<unknown, unknown>)[Symbol.asyncIterator] ===
      "function" &&
    typeof (value as AsyncGenerator<unknown, unknown>).next === "function"
  );
}

async function* transformUserEvents(
  gen: AsyncGenerator<unknown, unknown>,
  streamChunks: boolean = false
): AsyncGenerator<unknown, unknown> {
  let sent: unknown;

  while (true) {
    const next = await gen.next(sent);
    if (next.done) return next.value;

    if (next.value instanceof Trace) {
      sent = undefined;
    } else {
      const value =
        streamChunks &&
        !(next.value instanceof Signal) &&
        !(next.value instanceof Wind.Stream)
          ? new Wind.Stream(next.value)
          : next.value;
      sent = yield value;
    }
  }
}

function isSelfCall(value: unknown): value is AsyncGenerator<unknown, unknown> {
  return value !== null && typeof value === "object" && SelfTag in value;
}

async function* transformUserEventsFromFirst(
  gen: AsyncGenerator<unknown, unknown>,
  first: IteratorResult<unknown, unknown>
): AsyncGenerator<unknown, unknown> {
  let sent: unknown;
  let next = first;

  while (true) {
    if (next.done) return next.value;

    sent = next.value instanceof Trace ? undefined : yield next.value;
    next = await gen.next(sent);
  }
}

function prependAsyncGenerator(
  first: IteratorYieldResult<unknown>,
  gen: AsyncGenerator<unknown, unknown>
): AsyncGenerator<unknown, unknown> {
  return (async function* () {
    yield first.value;
    return yield* gen;
  })();
}

const DeferredStepTag = Symbol.for("TW.DeferredStep");

type DeferredStep = {
  [DeferredStepTag]: true;
  name: string;
  gen: AsyncGenerator<unknown, unknown>;
  done: boolean;
  traced: boolean;
  result: unknown;
};

function isDeferredStep(value: unknown): value is DeferredStep {
  return (
    value !== null && typeof value === "object" && DeferredStepTag in value
  );
}

function deferStep(
  name: string,
  gen: AsyncGenerator<unknown, unknown>
): DeferredStep {
  const deferred: DeferredStep = {
    [DeferredStepTag]: true,
    name,
    gen: undefined as unknown as AsyncGenerator<unknown, unknown>,
    done: false,
    traced: false,
    result: undefined,
  };

  deferred.gen = (async function* () {
    deferred.result = yield* transformUserEvents(gen, true);
    deferred.done = true;
    return deferred.result;
  })();

  return deferred;
}

async function* drainDeferredStep(
  deferred: DeferredStep
): AsyncGenerator<unknown, unknown> {
  try {
    const result = deferred.done ? deferred.result : yield* deferred.gen;
    let finalResult = result;

    if (finalResult instanceof Signal) {
      yield finalResult;
      finalResult = finalResult.data;
    }

    if (!deferred.traced) {
      yield new Trace(deferred.name, { result: finalResult });
      deferred.traced = true;
    }

    deferred.result = finalResult;
    deferred.done = true;
    return finalResult;
  } catch (error) {
    if (!deferred.traced) {
      yield new Trace(deferred.name, { error });
      deferred.traced = true;
    }

    throw error;
  }
}

function rawStepName(handler: unknown): unknown {
  if (handler === null || handler === undefined) return undefined;
  return (handler as any)[TW.Name];
}

function isPipeStep(handler: unknown): boolean {
  const name = rawStepName(handler);
  return Array.isArray(name) && name[0] === "|>";
}

function stepRuntimeName(handler: unknown): string {
  const name = rawStepName(handler);
  return Array.isArray(name) && name[0] === "|>"
    ? String(name[1])
    : String(name);
}

function commandEvent(input: unknown): Signal<"Command", object> {
  return new Signal("Command", {
    ...(input !== null && typeof input === "object" ? input : {}),
  });
}

function wrapUnionInput(
  inputMode: "first" | "args",
  args: unknown[],
  inputSchema: unknown
): unknown[] {
  if (inputMode !== "first" || !isUnionSchema(inputSchema)) return args;
  if (args[0] instanceof TW.Union) return args;
  return [new TW.Union(args[0]), ...args.slice(1)];
}

function isStepHandler(handler: unknown): boolean {
  return (
    handler !== null && handler !== undefined && TW.Name in Object(handler)
  );
}

function isRawFunctionHandler(handler: unknown): boolean {
  return typeof handler === "function" && !isStepHandler(handler);
}

function validateRunHandlers(handlers: unknown[]) {
  if (!isStepHandler(handlers[0])) return;

  const mixedIndex = handlers.slice(1).findIndex(isRawFunctionHandler);
  if (mixedIndex !== -1) {
    throw new Error(
      "Action.run cannot mix Step(...) handlers with raw function handlers"
    );
  }
}

async function* runStep(
  name: string,
  handler: (...a: unknown[]) => unknown,
  ctx: Record<string | symbol, unknown>,
  args: unknown[] = [],
  deferAsyncGenerator: boolean = false
): AsyncGenerator<unknown, unknown> {
  try {
    let result: unknown;
    if (handler instanceof AsyncGeneratorFunction) {
      const gen = handler.call(ctx, ...args) as AsyncGenerator<
        unknown,
        unknown
      >;
      result = deferAsyncGenerator
        ? deferStep(name, gen)
        : yield* transformUserEvents(gen, true);
    } else {
      const ret = handler.call(ctx, ...args);
      // If the step returned a self-recursive generator, propagate its events
      // and return its result without emitting a step result event for this step.
      if (isSelfCall(ret)) {
        return yield* ret as AsyncGenerator<unknown, unknown>;
      }
      const awaited = await ret;
      if (isSelfCall(awaited)) {
        return yield* awaited;
      }
      result = isAsyncGenerator(awaited)
        ? deferAsyncGenerator
          ? deferStep(name, awaited)
          : yield* transformUserEvents(awaited, true)
        : awaited;
    }
    if (isDeferredStep(result)) return result;
    if (result instanceof Signal) {
      yield result;
      result = result.data;
    }
    yield new Trace(name, { result });

    return result;
  } catch (error) {
    yield new Trace(name, { error });

    throw error;
  }
}

type IfEntry = { condition: unknown; steps: unknown[] };
type ElseEntry = { steps: unknown[] };
type LoopEntry = { name: string; items: unknown; steps: unknown[] };
type ParallelEntry = { steps: unknown[] };

function twType(handler: unknown): string | null {
  return handler !== null && typeof handler === "object"
    ? ((handler as any)[TW.Type] as string | undefined) ?? null
    : null;
}

async function evalCond(
  condition: unknown,
  ctx: Record<string | symbol, unknown>
): Promise<boolean> {
  const val =
    typeof condition === "function"
      ? await (condition as (scope: unknown) => unknown).call(ctx, ctx)
      : twType(condition) === "Cond"
      ? await ((condition as any).fn as (scope: unknown) => unknown).call(
          ctx,
          ctx
        )
      : condition;
  return Boolean(val);
}

async function* runHandlerList(
  name: string,
  handlers: unknown[],
  ctx: Record<string | symbol, unknown>,
  loopAcc: Record<string, unknown[]> | null,
  /** When true (self-recursive calls), if/else/elseIf branches don't add a prefix segment. */
  transparent: boolean = false,
  /** The top-level action name for this invocation; used to name self-call generators. */
  actionName: string = name,
  /** The top-level handlers for this invocation; passed to self-recursive runAction calls. */
  actionHandlers: unknown[] = handlers
): AsyncGenerator<
  unknown,
  { last: unknown; lastStepName: string | null; lastCond: boolean | null }
> {
  // `currentName` can be promoted from a branch name (e.g. "factorial.else") back to the
  // action name ("factorial") after a step calls `self`, so that subsequent steps in the
  // same branch are named relative to the action rather than the branch.
  let currentName = name;
  let last: unknown;
  let lastStepName: string | null = null;
  let lastCond: boolean | null = null;

  const recordStep = (stepName: string, value: unknown) => {
    ctx[stepName] = value;
    if (loopAcc) {
      if (!loopAcc[stepName]) loopAcc[stepName] = [];
      loopAcc[stepName].push(value);
    }
    lastStepName = stepName;
    last = value;
  };

  const adopt = (r: { last: unknown; lastStepName: string | null }) => {
    last = r.last;
    if (r.lastStepName) lastStepName = r.lastStepName;
  };

  const settleDeferredLast = async function* () {
    if (!isDeferredStep(last)) return last;

    const stepResult = yield* drainDeferredStep(last);
    if (lastStepName !== null) {
      recordStep(lastStepName, stepResult);
    } else {
      last = stepResult;
    }
    return stepResult;
  };

  for (let handlerIndex = 0; handlerIndex < handlers.length; handlerIndex++) {
    const handler = handlers[handlerIndex];
    const nextHandler = handlers[handlerIndex + 1];
    const type = twType(handler);
    const pipeStep = isPipeStep(handler);

    if (!pipeStep) {
      yield* settleDeferredLast();
    }

    if (type === "If") {
      const { condition, steps } = handler as IfEntry;
      const isCondNode = twType(condition) === "Cond";
      let condRaw: unknown;
      if (isCondNode) {
        condRaw = await ((condition as any).fn as Function).call(ctx, ctx);
        lastCond = Boolean(condRaw);
      } else {
        lastCond = await evalCond(condition, ctx);
      }

      if (lastCond) {
        if (isCondNode) ctx["condition"] = condRaw;
        const branchName = transparent ? currentName : `${currentName}.if`;
        adopt(
          yield* runHandlerList(
            branchName,
            steps as unknown[],
            ctx,
            loopAcc,
            transparent,
            actionName,
            actionHandlers
          )
        );
      }
    } else if (type === "ElseIf") {
      if (lastCond === false) {
        const { condition, steps } = handler as IfEntry;
        const isCondNode = twType(condition) === "Cond";
        let condRaw: unknown;
        if (isCondNode) {
          condRaw = await ((condition as any).fn as Function).call(ctx, ctx);
          lastCond = Boolean(condRaw);
        } else {
          lastCond = await evalCond(condition, ctx);
        }

        if (lastCond) {
          if (isCondNode) ctx["condition"] = condRaw;
          const branchName = transparent
            ? currentName
            : `${currentName}.elseIf`;
          adopt(
            yield* runHandlerList(
              branchName,
              steps as unknown[],
              ctx,
              loopAcc,
              transparent,
              actionName,
              actionHandlers
            )
          );
        }
      }
    } else if (type === "Else") {
      if (lastCond === false) {
        const branchName = transparent ? currentName : `${currentName}.else`;
        adopt(
          yield* runHandlerList(
            branchName,
            (handler as ElseEntry).steps as unknown[],
            ctx,
            loopAcc,
            transparent,
            actionName,
            actionHandlers
          )
        );
      }
      lastCond = null;
    } else if (type === "Loop") {
      lastCond = null;
      const {
        name: loopName,
        items: itemsGetter,
        steps,
      } = handler as LoopEntry;
      const items =
        typeof itemsGetter === "function"
          ? await (itemsGetter as (scope: unknown) => unknown).call(ctx, ctx)
          : twType(itemsGetter) === "ForEach"
          ? await ((itemsGetter as any).fn as (scope: unknown) => unknown).call(
              ctx,
              ctx
            )
          : typeof itemsGetter === "string"
          ? (itemsGetter as string)
              .split(".")
              .reduce((o: any, k) => o?.[k], ctx)
          : itemsGetter;
      yield new Trace(`${currentName}.${loopName}`, { items });
      const innerAcc: Record<string, unknown[]> = {};
      let loopLastStepName: string | null = null;
      const loopIterLasts: unknown[] = [];
      const flatSteps = steps as unknown[];
      for (let index = 0; index < (items as unknown[]).length; index++) {
        ctx[loopName] = { item: (items as unknown[])[index], index };
        const r = yield* runHandlerList(
          `${currentName}.${loopName}[${index}]`,
          flatSteps,
          ctx,
          innerAcc,
          transparent,
          actionName,
          actionHandlers
        );
        if (r.lastStepName) loopLastStepName = r.lastStepName;
        loopIterLasts.push(r.last);
      }
      delete ctx[loopName];
      for (const [k, v] of Object.entries(innerAcc)) {
        ctx[k] = v;
        if (loopAcc) {
          if (!loopAcc[k]) loopAcc[k] = [];
          loopAcc[k].push(v);
        }
      }
      if (loopLastStepName !== null) {
        last = innerAcc[loopLastStepName] ?? [];
        lastStepName = loopLastStepName;
      } else {
        // Non-step last per iteration (e.g. Parallel as final handler in loop body)
        const hasDirectLast = loopIterLasts.some((v) => v !== undefined);
        last = hasDirectLast ? loopIterLasts : [];
      }
    } else if (type === "Parallel") {
      lastCond = null;
      const { steps: parallelSteps } = handler as ParallelEntry;

      // Run each step concurrently in an independent snapshot of ctx.
      // Using runHandlerList (single-step) so that `self` injection and other
      // machinery work identically to sequential steps.
      const stepResults = await Promise.all(
        parallelSteps.map(async (step) => {
          const stepCtx = { ...ctx };
          const events: unknown[] = [];

          const gen = runHandlerList(
            currentName,
            [step],
            stepCtx,
            null,
            transparent,
            actionName,
            actionHandlers
          );

          let iterResult: {
            last: unknown;
            lastStepName: string | null;
            lastCond: boolean | null;
          } = { last: undefined, lastStepName: null, lastCond: null };

          let item = await gen.next();
          while (!item.done) {
            events.push(item.value);
            item = await gen.next();
          }
          iterResult = item.value as typeof iterResult;

          return {
            events,
            last: iterResult.last,
            stepName: iterResult.lastStepName,
          };
        })
      );

      // Yield all step events in declaration order (deterministic)
      for (const { events } of stepResults) {
        for (const event of events) yield event;
      }

      // Merge results into outer ctx and build parallel-last object
      const parallelLast: Record<string, unknown> = {};
      for (const { stepName, last: stepLast } of stepResults) {
        if (stepName === null) continue;
        ctx[stepName] = stepLast;
        parallelLast[stepName] = stepLast;
        if (loopAcc) {
          if (!loopAcc[stepName]) loopAcc[stepName] = [];
          loopAcc[stepName].push(stepLast);
        }
      }

      last = parallelLast;
      // Explicitly null so the loop handler falls through to loopIterLasts tracking
      lastStepName = null;
    } else if (
      (typeof handler === "function" || Array.isArray(handler)) &&
      TW.Name in Object(handler)
    ) {
      lastCond = null;
      const stepName = stepRuntimeName(handler);
      const fn = Array.isArray(handler)
        ? ((handler as unknown[])[0] as (...a: unknown[]) => unknown)
        : (handler as (...a: unknown[]) => unknown);
      const stepArgs = pipeStep
        ? [isDeferredStep(last) ? unwrapStreamEvents(last.gen) : last]
        : [];
      const deferAsyncGenerator = pipeStep || isPipeStep(nextHandler);

      // Inject `this.self` so the step can recursively re-invoke the action.
      // The self-call name is `actionName.stepName` (e.g. "factorial.next"),
      // and runs in transparent mode so if/else branches don't add prefix segments.
      const _actionName = actionName;
      const _stepName = stepName;
      const _actionHandlers = actionHandlers;
      ctx["self"] = (input: unknown) => {
        ctx[SelfCalledTag] = true;
        const nextInput =
          ctx.input instanceof TW.Union && !(input instanceof TW.Union)
            ? new TW.Union(input)
            : input;
        const gen = runAction(
          `${_actionName}.${_stepName}`,
          buildScope("first", [nextInput], {
            ...ctx,
            event: commandEvent(input),
          }),
          _actionHandlers,
          true
        );
        Object.defineProperty(gen, SelfTag, { value: true, enumerable: false });
        return gen;
      };

      recordStep(
        stepName,
        yield* runStep(
          `${currentName}.${stepName}`,
          fn,
          ctx,
          stepArgs,
          deferAsyncGenerator
        )
      );

      // If this step called self, promote currentName back to actionName so that
      // subsequent steps in the same branch use the action name as their prefix
      // (e.g. "factorial.multiply" rather than "factorial.else.multiply").
      if (ctx[SelfCalledTag]) {
        currentName = actionName;
        delete ctx[SelfCalledTag];
      }
    } else if (handler instanceof AsyncGeneratorFunction) {
      lastCond = null;
      last = yield* transformUserEvents(
        (
          handler as (this: typeof ctx) => AsyncGenerator<unknown, unknown>
        ).call(ctx)
      );
    } else if (typeof handler === "function") {
      lastCond = null;
      const ret = await (handler as (this: typeof ctx) => unknown).call(ctx);
      if (isAsyncGenerator(ret)) {
        const first = await ret.next();
        if (first.done) {
          last = first.value;
        } else if (
          first.value instanceof Signal ||
          first.value instanceof Trace
        ) {
          last = yield* transformUserEventsFromFirst(ret, first);
        } else {
          last = prependAsyncGenerator(first, ret);
        }
      } else {
        last = ret;
      }
      if (last instanceof Signal) {
        yield last;
        last = last.data;
      }
    }
  }

  yield* settleDeferredLast();

  return { last, lastStepName, lastCond };
}

export async function* runAction(
  name: string,
  scope: Scope,
  handlers: unknown[],
  /** When true (self-recursive calls), if/else/elseIf branches don't add prefix segments. */
  transparent: boolean = false
): AsyncGenerator<unknown, unknown> {
  const ctx: Record<string | symbol, unknown> = { ...scope };
  const observed = new Set<object>();
  type ActionObservation = (() => Iterable<unknown>) & {
    dispose?: () => void;
  };
  const actionObservers: ActionObservation[] = [];
  const publishedEvents: unknown[] = [];
  let eventWaiter: (() => void) | null = null;
  let acceptingEvents = true;

  const publish = (event: unknown) => {
    if (!acceptingEvents) return;
    publishedEvents.push(event);
    eventWaiter?.();
    eventWaiter = null;
  };

  const waitForPublishedEvent = () =>
    publishedEvents.length > 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          eventWaiter = resolve;
        });

  const observeValue = (value: unknown) => {
    if (value === null || typeof value !== "object" || observed.has(value)) {
      return;
    }
    observed.add(value);
    const observe = (value as Record<symbol, unknown>)[TW.ActionObserver];
    if (typeof observe === "function") {
      actionObservers.push(
        (
          observe as (
            actionName: string,
            publish: (event: unknown) => void
          ) => ActionObservation
        )(name, publish)
      );
    }
  };

  // Steps that materialize scoped resources after the action has started can
  // register those values with the same observer lifecycle.
  ctx[TW.ActionObserver] = observeValue;
  for (const value of Object.values(ctx)) observeValue(value);

  const observedEvents = () =>
    actionObservers.flatMap((observe) => Array.from(observe()));

  const traceInput =
    scope.input instanceof TW.Union ? scope.input.unwrap() : scope.input;
  yield new Trace(name, { input: traceInput });

  const handlerStream = runHandlerList(
    name,
    handlers,
    ctx,
    null,
    transparent,
    name,
    handlers
  );

  const runHandlers = async function* () {
    let handlerNext = handlerStream.next();

    while (true) {
      while (publishedEvents.length > 0) {
        yield publishedEvents.shift();
      }

      const next = await Promise.race([
        handlerNext.then((value) => ({ source: "handler" as const, value })),
        waitForPublishedEvent().then(() => ({ source: "observer" as const })),
      ]);

      if (next.source === "observer") continue;
      if (next.value.done) {
        while (publishedEvents.length > 0) {
          yield publishedEvents.shift();
        }
        return next.value.value;
      }

      yield next.value.value;
      handlerNext = handlerStream.next();
    }
  };

  try {
    const r = yield* runHandlers();
    for (const event of observedEvents()) yield event;
    yield new Trace(name, { result: r.last });
    return r.last;
  } catch (error) {
    for (const event of observedEvents()) yield event;
    yield new Trace(name, { error });
    throw error;
  } finally {
    acceptingEvents = false;
    eventWaiter = null;
    for (const observe of actionObservers) observe.dispose?.();
  }
}

function bindContextualActions(
  value: unknown,
  context: ExecutionContext,
  visited = new WeakMap<object, unknown>()
): unknown {
  if (typeof value === "function") {
    const contextual = (value as ContextualAction)[ContextualActionTag];
    return typeof contextual === "function"
      ? (...args: unknown[]) => contextual(context, ...args)
      : value;
  }

  if (value === null || typeof value !== "object") return value;
  if (visited.has(value)) return visited.get(value);

  const clone = (Array.isArray(value) ? [] : {}) as Record<
    string | symbol,
    unknown
  >;
  visited.set(value, clone);

  for (const [key, nested] of Object.entries(
    value as Record<string, unknown>
  )) {
    clone[key] = bindContextualActions(nested, context, visited);
  }

  for (const key of Object.getOwnPropertySymbols(value)) {
    clone[key] = bindContextualActions(
      (value as Record<string | symbol, unknown>)[key],
      context,
      visited
    );
  }

  return clone;
}

function mergeScopeActions(
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

function mergeScope(
  ...scopes: Record<string | symbol, unknown>[]
): Record<string | symbol, unknown> {
  return scopes.reduce<Record<string | symbol, unknown>>(
    (existing, incoming) => {
      const { actions: incomingActions, ...incomingScope } = incoming;
      const next: Record<string | symbol, unknown> = {
        ...existing,
        ...incomingScope,
      };

      if (incomingActions !== null && typeof incomingActions === "object") {
        next.actions = mergeScopeActions(
          (existing.actions as Record<string, unknown> | undefined) ?? {},
          incomingActions as Record<string, unknown>
        );
      }

      return next;
    },
    {}
  );
}

export function buildScope(
  inputMode: "first" | "args",
  args: unknown[],
  extra: Record<string | symbol, unknown> = {}
): Scope {
  const eventNames = new Map<string, string>();
  const userExtra: Record<string | symbol, unknown> = {};

  for (const [key, value] of Object.entries(extra)) {
    const isEventKind =
      value !== null &&
      typeof value === "object" &&
      TW.Name in value &&
      "emit" in value;

    if (isEventKind) {
      const name = (value as Record<string | symbol, unknown>)[TW.Name];
      if (typeof name === "string") eventNames.set(key, name);
    } else {
      userExtra[key] = value;
    }
  }

  for (const key of Object.getOwnPropertySymbols(extra)) {
    userExtra[key] = extra[key];
  }

  const scope: Scope = {
    ...userExtra,
    input: inputMode === "args" ? args : args[0],
    async *signal<T extends string, D extends Record<string, unknown>>(
      type: T,
      data: D
    ) {
      const signal = new Signal((eventNames.get(type) ?? type) as T, data);
      yield signal;
      return signal.data;
    },
  };

  if ("actions" in scope) {
    scope.actions = bindContextualActions(scope.actions, scope);
  }

  return scope;
}

export function Action<const Name extends string>(
  name: CamelCase<Name>
): ActionFactory<Name> {
  const actionName = name as string;
  let logger: ConsoleLike = console;
  let inferType = false;
  let inferTypeFilter: string | undefined = undefined;
  const injectedActions: Record<string, unknown> = {};
  const pendingPlugins: Promise<void>[] = [];
  let actionMeta: unknown = null;

  function tap<G extends AsyncGenerator<unknown, unknown>>(gen: G): G {
    return tapWith(gen, dispatch(logger)) as G;
  }

  function detectPlugin(config: LoggerConfig | InferTypeConfig<any>) {
    if ((config as any)[TW.Type] === "InferType") {
      inferType = true;
      inferTypeFilter = (config as InferTypeConfig<any>).filter;
    } else {
      logger = (config as LoggerConfig).target;
    }
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
      typeof (plugin as { [RawStreamTag]?: unknown })[RawStreamTag] ===
        "function"
      ? (plugin as { [RawStreamTag]: (...args: unknown[]) => unknown })[
          RawStreamTag
        ]
      : typeof plugin === "function" &&
        "stream" in plugin &&
        typeof (plugin as { stream?: unknown }).stream === "function"
      ? (plugin as { stream: (...args: unknown[]) => unknown }).stream
      : plugin;
  }

  function injectAction(plugin: unknown) {
    const fullName: unknown = (plugin as any)[TW.Name];
    if (typeof fullName !== "string") return;
    const exposed = exposeAction(plugin);
    const qualified = splitQualifiedActionName(fullName);
    if (qualified === null) {
      injectedActions[fullName] = exposed;
    } else {
      const service =
        qualified.service.charAt(0).toLowerCase() + qualified.service.slice(1);
      const method = qualified.method;
      injectedActions[service] = {
        ...(injectedActions[service] as Record<string, unknown> | undefined),
        [method]: exposed,
      };
    }
  }

  function injectActions(plugin: unknown, visited = new WeakSet<object>()) {
    if (typeof plugin === "function") {
      injectAction(plugin);
      return;
    }

    if (plugin === null || typeof plugin !== "object") return;
    if (visited.has(plugin)) return;
    visited.add(plugin);
    if ("then" in (plugin as object)) {
      pendingPlugins.push(Promise.resolve(plugin).then(injectActions));
      return;
    }

    for (const value of Object.values(plugin as Record<string, unknown>)) {
      if (typeof value === "function") {
        injectAction(value);
      } else {
        injectActions(value, visited);
      }
    }
  }

  function isEventKind(
    value: unknown
  ): value is Record<string | symbol, unknown> {
    return (
      value !== null &&
      typeof value === "object" &&
      TW.Name in value &&
      "emit" in value
    );
  }

  function hasEventExports(value: unknown): value is { events: unknown } {
    return (
      value !== null &&
      (typeof value === "object" || typeof value === "function") &&
      "events" in value
    );
  }

  const injectedEvents: Record<string, unknown> = {};
  const pendingEventPlugins: Promise<void>[] = [];

  function injectEvents(plugin: unknown) {
    if (isEventKind(plugin)) {
      const eventName = plugin[TW.Name];
      if (typeof eventName === "string") injectedEvents[eventName] = plugin;
      return;
    }

    if (hasEventExports(plugin)) {
      injectEvents(plugin.events);
      return;
    }

    if (plugin === null || typeof plugin !== "object") return;
    if ("then" in (plugin as object)) {
      pendingEventPlugins.push(Promise.resolve(plugin).then(injectEvents));
      return;
    }

    for (const [key, value] of Object.entries(
      plugin as Record<string, unknown>
    )) {
      if (!isEventKind(value)) continue;
      const eventName = value[TW.Name];
      injectedEvents[key] = value;
      if (typeof eventName === "string") injectedEvents[eventName] = value;
    }
  }

  function usePlugin(config: unknown) {
    const type =
      config !== null && typeof config === "object"
        ? (config as any)[TW.Type]
        : undefined;
    if (type === "Logger" || type === "InferType") {
      detectPlugin(config as LoggerConfig | InferTypeConfig);
    } else {
      injectActions(config);
      injectEvents(config);
    }
  }

  async function buildExtra() {
    if (pendingPlugins.length > 0) await Promise.all(pendingPlugins);
    if (pendingEventPlugins.length > 0) await Promise.all(pendingEventPlugins);

    return {
      ...(Object.keys(injectedEvents).length > 0 ? { ...injectedEvents } : {}),
      ...(Object.keys(injectedActions).length > 0
        ? { actions: { ...injectedActions } }
        : {}),
    };
  }

  function createAction(
    inputMode: "first" | "args",
    handlers: unknown[],
    inputSchema?: unknown
  ) {
    validateRunHandlers(handlers);

    if (inferType) {
      const steps: Array<Record<string, unknown>> = [];
      for (const handler of handlers) {
        if (
          handler !== null &&
          handler !== undefined &&
          TW.Name in Object(handler)
        ) {
          const stepName = (handler as any)[TW.Name] as string;
          const fn = Array.isArray(handler) ? (handler as any[])[0] : handler;
          const actionCall = probeForActionCall(fn as Function);
          if (actionCall) {
            steps.push({
              $: actionCall.name,
              "=": stepName,
              ...actionCall.params,
            });
          } else {
            steps.push({
              $: "step",
              "=": stepName,
              run: `@{${(fn as Function).toString().replace(/^\s+/gm, "")}}`,
            });
          }
        }
      }
      if (inferTypeFilter !== undefined) {
        const filtered = steps.find((s) => s["="] === inferTypeFilter);
        return { [actionName]: filtered };
      }

      return { [actionName]: { "->": "Command", "=": actionName, run: steps } };
    }

    async function actionRunCtx(context: TW.ActionContext, ...args: unknown[]) {
      const runContext = normalizeActionContext(context);
      const extra = mergeScope(
        await buildExtra(),
        { event: commandEvent(args[0]) },
        runContext
      );
      const gen = tap(
        unwrapStreamEvents(
          runAction(
            actionName,
            buildScope(
              inputMode,
              wrapUnionInput(inputMode, args, inputSchema),
              extra
            ),
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
      const extra = mergeScope(
        await buildExtra(),
        { event: commandEvent(args[0]) },
        runContext
      );
      return yield* runAction(
        actionName,
        buildScope(
          inputMode,
          wrapUnionInput(inputMode, args, inputSchema),
          extra
        ),
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

    const action = Object.assign(consume, {
      [TW.Name]: actionName,
      [TW.Meta]: actionMeta,
      [TW.InputSchema]: inputSchema,
      run: actionRun,
      stream,
      ctx,
      [RawStreamTag]: rawStream,
      [RawLoggedStreamTag]: loggedRawStream,
    });
    const result = {
      [actionName]: action,
      meta(meta: Record<string, unknown>) {
        const resolvedMeta = resolveMetaExpressionBuilders(meta);
        actionMeta = {
          ...(actionMeta !== null && typeof actionMeta === "object"
            ? actionMeta
            : {}),
          ...resolvedMeta,
        };
        action[TW.Meta] = actionMeta;
        return result;
      },
    };

    return result;
  }

  const makeBody = (inputMode: "first" | "args", inputSchema?: unknown) => ({
    addStateCommand(
      alias: string,
      commands: Record<string, Record<string, unknown>>
    ) {
      const currentMeta =
        actionMeta !== null && typeof actionMeta === "object"
          ? (actionMeta as Record<string, unknown>)
          : {};
      const currentCommands =
        currentMeta.stateCommands !== null &&
        typeof currentMeta.stateCommands === "object"
          ? (currentMeta.stateCommands as Record<string, unknown>)
          : {};
      actionMeta = {
        ...currentMeta,
        stateCommands: {
          ...currentCommands,
          [alias]: commands,
        },
      };
      return this;
    },
    use(...configs: unknown[]) {
      for (const config of configs) usePlugin(config);
      return this;
    },
    run(...handlers: unknown[]) {
      return createAction(inputMode, handlers, inputSchema);
    },
  });

  return {
    sig() {
      return makeBody("args");
    },
    input(...schema: unknown[]) {
      return makeBody("first", schema.length <= 1 ? schema[0] : schema);
    },
    use(...configs: unknown[]) {
      for (const config of configs) usePlugin(config);
      return this;
    },
    run(...handlers: unknown[]) {
      return createAction("first", handlers);
    },
  } as any;
}
