import { Type, type } from "arktype";
import { StandardSchemaV1 } from "@standard-schema/spec";
import type { TW } from "./core";
import type { InferTypeConfig } from "./use";
import type { Signal, Trace } from "@taskwish/wind";

/** Walk the plugins tuple and return the filter type from the first InferTypeConfig found.
 *  - `never`     → no InferType plugin present
 *  - `undefined` → InferType() with no filter (infer all steps)
 *  - `F`         → InferType(filter) (infer only the matching step)
 */
export type FindInferTypeFilter<Plugins> = Plugins extends readonly [
  infer Head,
  ...infer Tail
]
  ? Head extends InferTypeConfig<infer F>
    ? F
    : FindInferTypeFilter<Tail>
  : never;

export type Expect<T extends true> = T;

export type DeepWriteable<T> = {
  -readonly [P in keyof T]: DeepWriteable<T[P]>;
} & {};

export type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <
  T
>() => T extends Y ? 1 : 2
  ? true
  : false;

export type UnionData<Type> = Type extends TW.Union<infer Data> ? Data : Type;

export function isUnionSchema(schema: unknown): boolean {
  if (Array.isArray(schema)) return schema.includes("|");
  if (schema === null || typeof schema !== "object") return false;

  const candidate = schema as { kind?: unknown; branches?: unknown };
  return (
    candidate.kind === "union" ||
    (Array.isArray(candidate.branches) && candidate.branches.length > 1)
  );
}

export type StripEventKinds<S> = {
  [K in keyof S as S[K] extends TW.EventKind<any, any, any> ? never : K]: S[K];
};

type IsListenerAction<Action> = Action extends TW.Attributable<infer Meta>
  ? Meta extends { event: string; command: string }
    ? false
    : Meta extends { event: string }
    ? true
    : false
  : false;

export type OmitListeners<Actions> = Pretty<{
  [Key in keyof Actions as IsListenerAction<Actions[Key]> extends true
    ? never
    : Key]: Actions[Key];
}>;

export type PickListeners<Actions> = Pretty<{
  [Key in keyof Actions as IsListenerAction<Actions[Key]> extends true
    ? Key
    : never]: Actions[Key];
}>;

export type CamelCaseHelper<T extends string> =
  T extends `${infer Left}${infer Delimiter}${infer Right}`
    ? Delimiter extends " " | "_" | "-" | "." | "," | "!"
      ? `${Left}${Capitalize<ToCamelCase<Right>>}`
      : `${Left}${CamelCaseHelper<`${Delimiter}${Right}`>}`
    : T;

export type LowercaseFirst<T extends string> =
  T extends `${infer First}${infer Rest}` ? `${Lowercase<First>}${Rest}` : T;

export type UppercaseFirst<T extends string> =
  T extends `${infer First}${infer Rest}` ? `${Uppercase<First>}${Rest}` : T;

export type ToCamelCase<T extends string> = LowercaseFirst<CamelCaseHelper<T>>;

export type ToCapitalCase<T extends string> = UppercaseFirst<
  CamelCaseHelper<T>
>;

export type QualifiedActionName<
  Service extends string,
  Name extends string
> = `${Service}::${Name}`;

export type QualifiedEventName<
  Actor extends string,
  Name extends string
> = `${Actor}::${Name}`;

export function toCamelCaseName(name: string): string {
  return name.replace(/[_-\s.]+([a-zA-Z0-9])/g, (_, ch: string) =>
    ch.toUpperCase()
  );
}

export function qualifyActionName(service: string, name: string): string {
  return `${service}::${name}`;
}

export function qualifyEventName(actor: string, name: string): string {
  return `${actor}::${name}`;
}

export function splitQualifiedActionName(
  fullName: string
): { service: string; method: string } | null {
  const sepIdx = fullName.indexOf("::");
  if (sepIdx !== -1) {
    return {
      service: fullName.slice(0, sepIdx),
      method: toCamelCaseName(fullName.slice(sepIdx + 2)),
    };
  }

  const dotIdx = fullName.indexOf(".");
  if (dotIdx === -1) return null;
  return {
    service: fullName.slice(0, dotIdx),
    method: fullName.slice(dotIdx + 1),
  };
}

export type PrettyScope<T> = {
  [K in keyof T as 0 extends 1 & T[K]
    ? Extract<K, string>
    : T[K] extends Type<any>
    ? Extract<K, string>
    : Extract<K, string>]: T[K];
} & {};

export type Pretty<T> = { [K in keyof T]: T[K] } & {};

export type Append<Items, Item> = Items extends readonly any[]
  ? [...Items, Item]
  : [Item];

// ── Scope operator machinery ──────────────────────────────────────────────────

export type RawEntry<R, Ops extends string[] = [], Yields = never> = {
  result: R;
  yields: Yields;
  operator: Ops;
};

type RemoveEndOps<
  T extends readonly string[],
  A extends string[] = []
> = T extends [infer H extends string, ...infer Rest extends string[]]
  ? H extends ":end"
    ? RemoveEndOps<Rest, A extends [...infer X extends string[], any] ? X : []>
    : RemoveEndOps<Rest, [...A, H]>
  : A;

type ApplyOps<O extends readonly string[], R> = O extends [
  ...infer Rest extends string[],
  infer Last extends string
]
  ? Last extends ":loop"
    ? ApplyOps<Rest, R[]>
    : Last extends ":if"
    ? ApplyOps<Rest, R | undefined>
    : ApplyOps<Rest, R>
  : R;

export type ResolveScope<T> = Pretty<{
  [K in keyof T]: T[K] extends {
    result: infer R;
    operator: infer O extends string[];
  }
    ? ApplyOps<RemoveEndOps<O>, R>
    : T[K];
}>;

export type ResolveLast<T> = T extends {
  result: infer R;
  operator: infer O extends string[];
}
  ? ApplyOps<RemoveEndOps<O>, R>
  : T;

export type DeepOptionalString<T> = {
  [K in keyof T]?: T[K] extends object ? DeepOptionalString<T[K]> : string;
};

export async function standardValidate<T extends StandardSchemaV1>(
  schema: T,
  input: StandardSchemaV1.InferInput<T>
): Promise<StandardSchemaV1.InferOutput<T>> {
  let result = schema["~standard"].validate(input);
  if (result instanceof Promise) result = await result;

  // if the `issues` field exists, the validation failed
  if (result.issues) {
    throw new Error(JSON.stringify(result.issues, null, 2));
  }

  return result.value;
}

export type UUIDv7String = `${string}-${string}-7${string}-${string}-${string}`;

export type UUIDv5String = `${string}-${string}-5${string}-${string}-${string}`;

export type ValidateSchema<
  Schema,
  Scope = {}
> = Schema extends StandardSchemaV1<any>
  ? Schema
  : type.validate<Schema, Scope>;

export type InferSchema<Schema, Scope = {}> = Schema extends StandardSchemaV1<
  infer Input
>
  ? Input
  : type.instantiate<Schema, Scope>["infer"];

export type ValidateTrigger<Schema> = Schema extends TW.EventKind<
  any,
  infer Input
>
  ? TW.EventKind<any, Input>
  : Schema extends Signal<any, infer Input>
  ? Signal<any, Input>
  : Schema extends StandardSchemaV1<any>
  ? Schema
  : Schema extends object
  ? type.validate<Schema>
  : object;

type HasOnlyNeverValues<T> = keyof T extends infer K
  ? K extends keyof T
    ? [T[K]] extends [never]
      ? true
      : false
    : never
  : never;

export type InferTriggerScope<Schema> = Schema extends Signal<
  infer Name,
  infer Input
>
  ? {
      input: Input;
      event: Signal<Name, Input>;
    }
  : Schema extends TW.EventKind<infer Name, infer Input, any>
  ? {
      input: Input;
      event: Signal<Name, Input>;
    }
  : HasOnlyNeverValues<type.instantiate<Schema>["infer"]> extends false
  ? {
      input: type.instantiate<Schema>["infer"];
      event: Signal<"Command", type.instantiate<Schema>["infer"]>;
    }
  : {
      input: Schema;
      event: Signal<"Command", Schema>;
    };

export type Apply<
  F extends TW.Handler,
  ctx extends Record<any, any>
> = NonNullable<
  (F & {
    readonly ctx: ctx;
  })["run"]
>;

const Fail = Symbol("Fail");

export type Fail<Message extends string> = Message;

type Separator = "_" | "-" | " ";

type HasSeparator<S extends string> = S extends `${string}${Separator}${string}`
  ? true
  : false;

type CamelCaseError<S extends string> = HasSeparator<S> extends true
  ? ["Expected camelCase string", "Remove separators from:", S]
  : S extends Uncapitalize<S>
  ? never
  : ["Expected camelCase string", "String must start with lowercase:", S];

export type CamelCase<S extends string> = CamelCaseError<S> extends never
  ? S
  : CamelCaseError<S>;

export type PascalCase<S extends string> = HasSeparator<S> extends true
  ? Fail<`Expected PascalCase string, got separator in "${S}"`>
  : S extends Capitalize<S>
  ? S
  : Fail<`Expected PascalCase string, "${S}" must start with uppercase`>;

// ── Action grouping type helpers ──────────────────────────────────────────────

type ExtractActionNameFromYield<Yield> = Yield extends Trace<
  infer N extends string,
  { input: any }
>
  ? N
  : Yield extends TW.ActionEvent<infer N extends string, any, any>
  ? N
  : never;

/** Extract the action name from a TW.Action resource or exposed action function. */
export type ExtractActionName<T> = T extends TW.Resource<infer N extends string>
  ? N
  : T extends (...args: any[]) => AsyncGenerator<infer Yield, any, any>
  ? ExtractActionNameFromYield<Yield>
  : never;

type QualifiedActionParts<N extends string> = N extends `${infer S}::${infer M}`
  ? [S, ToCamelCase<M>]
  : N extends `${infer S}.${infer M}`
  ? [S, M]
  : never;

type HasQualifiedActionService<N extends string> = [
  QualifiedActionParts<N>
] extends [never]
  ? false
  : QualifiedActionParts<N> extends [infer S extends string, string]
  ? S extends ""
    ? false
    : true
  : false;

type DirectActionName<N extends string> = [QualifiedActionParts<N>] extends [
  never
]
  ? N
  : QualifiedActionParts<N> extends ["", infer M extends string]
  ? M
  : never;

/** "Slack::post_message" → "postMessage" */
export type ActionService<N extends string> = QualifiedActionParts<N> extends [
  infer S extends string,
  string
]
  ? S extends ""
    ? never
    : LowercaseFirst<S>
  : never;

/** "Slack::post_message" → "postMessage" */
export type ActionMethod<N extends string> = QualifiedActionParts<N> extends [
  string,
  infer M extends string
]
  ? M
  : N;

type ExposedAction<T> = T extends {
  run: infer Run extends (...args: any[]) => any;
}
  ? Run
  : T extends {
      stream: infer Stream extends (...args: any[]) => any;
    }
  ? Stream
  : T;

export type ActionRecordName<N extends string> = [
  QualifiedActionParts<N>
] extends [never]
  ? N
  : QualifiedActionParts<N> extends [string, infer M extends string]
  ? M
  : never;

/**
 * Groups TW.Action exports in two ways:
 *  - Qualified names ("Slack::post_message") → nested `{ slack: { postMessage: T["stream"] } }`
 *  - Flat names ("notify")                  → direct  `{ notify: T["stream"] }`
 */
export type GroupActions<M> =
  // Qualified names → { service: { method: T } }
  {
    [S in {
      [K in keyof M]: ExtractActionName<M[K]> extends infer N extends string
        ? HasQualifiedActionService<N> extends true
          ? ActionService<N>
          : never
        : never;
    }[keyof M] &
      string]: {
      [K in keyof M as ExtractActionName<M[K]> extends infer N extends string
        ? HasQualifiedActionService<N> extends true
          ? ActionService<N> extends S
            ? ActionMethod<N>
            : never
          : never
        : never]: ExposedAction<M[K]>;
    };
  } & {
    // Flat names → { name: T } (directly callable)
    [K in keyof M as ExtractActionName<M[K]> extends infer N extends string
      ? DirectActionName<N>
      : never]: ExposedAction<M[K]>;
  };

/** Extract grouped actions from a plugin (plain object, single TW.Action, or Promise<module>). */
type ActionProperties<U> = {
  [K in keyof U as U[K] extends TW.Action<any, any, any> ? K : never]: U[K];
};

export type ActionsFromPlugin<U> = U extends Promise<infer M>
  ? GroupActions<M>
  : U extends (...args: any[]) => any
  ? GroupActions<Record<"_", U> & ActionProperties<U>>
  : GroupActions<U>;

type EventsFromRecord<U> = {
  [K in keyof U as U[K] extends TW.EventKind<any, any, any> ? K : never]: U[K];
} & {
  [K in keyof U as U[K] extends TW.EventKind<
    infer Name extends string,
    any,
    any
  >
    ? Name
    : never]: U[K];
};

export type EventsFromPlugin<U> = U extends Promise<infer M>
  ? EventsFromPlugin<M>
  : U extends { [TW.Scope]: infer S }
  ? EventsFromPlugin<S>
  : U extends TW.EventKind<infer Name extends string, any, any>
  ? {
      [K in Name]: U;
    }
  : U extends { events: infer E }
  ? EventsFromPlugin<E>
  : U extends (...args: any[]) => any
  ? {}
  : EventsFromRecord<U>;

type ScopeFromPlugin<U> = U extends Promise<infer Plugin>
  ? ScopeFromPlugin<Plugin>
  : U extends { [TW.Scope]: infer Scope extends Record<string, unknown> }
  ? Scope
  : {};

/** Merge actions from a plugin into Ctx["scope"]["actions"]. */
export type AddActionsToCtx<Ctx extends Record<any, any>, U> = {
  [K in keyof Ctx]: K extends "scope"
    ? Omit<Ctx["scope"], "actions"> &
        ScopeFromPlugin<U> & {
          actions: Pretty<
            ("actions" extends keyof Ctx["scope"]
              ? Ctx["scope"]["actions"]
              : {}) &
              ActionsFromPlugin<U>
          >;
        } & EventsFromPlugin<U>
    : Ctx[K];
};

export type AddActionsToCtxMany<
  Ctx extends Record<any, any>,
  Plugins extends readonly unknown[]
> = Plugins extends readonly [infer Plugin, ...infer Rest]
  ? AddActionsToCtxMany<AddActionsToCtx<Ctx, Plugin>, Rest>
  : Ctx;

type DefaultContextActionKeys = "generateText";

type DeepPartialContext<T> = T extends (...args: any[]) => any
  ? T
  : T extends readonly (infer Item)[]
  ? Array<DeepPartialContext<Item>>
  : T extends object
  ? { [K in keyof T]?: DeepPartialContext<T[K]> }
  : T;

export type ActionContextScope<Scope> = Scope extends {
  actions: infer Actions;
}
  ? ContextValueOverrides<Scope> &
      (Exclude<keyof Actions, DefaultContextActionKeys> extends never
        ? {}
        : {
            actions?: TW.Configurable<
              DeepPartialContext<Omit<Actions, DefaultContextActionKeys>>
            >;
          })
  : ContextValueOverrides<Scope>;

type StateContextOverride<Scope> = "state" extends keyof Scope
  ? { state?: TW.Configurable<DeepPartialContext<Scope["state"]>> }
  : {};

type AgentContextOverride<Scope> = "agent" extends keyof Scope
  ? { agent?: TW.Configurable<DeepPartialContext<Scope["agent"]>> }
  : {};

type ContextValueOverrides<Scope> = StateContextOverride<Scope> &
  AgentContextOverride<Scope> & {
    [Key in keyof Scope as Scope[Key] extends {
      generate: (...args: any[]) => any;
    }
      ? Key
      : never]?: TW.Configurable<DeepPartialContext<Scope[Key]>>;
  };

export type ActionCtx<Scope> = {
  abortSignal?: TW.Configurable<AbortSignal>;
} & ActionContextScope<Scope>;

export type StreamInput<Handler extends (...args: any) => any> =
  Parameters<Handler> extends []
    ? undefined
    : Parameters<Handler> extends [infer Input]
    ? Input
    : Parameters<Handler>;

export type StreamResult<Handler extends (...args: any) => any> = Awaited<
  ReturnType<Handler>
>;
