import {
  UUIDv7String,
  ValidateTrigger,
  InferTriggerScope,
  Pretty,
  OmitListeners,
  PickListeners,
  StreamInput,
  StreamResult,
  StripEventKinds,
  UnionData,
} from "./helpers";

import { Type as ArkType } from "arktype";
import type { Signal, Trace } from "@taskwish/wind";

export namespace TW {
  export const Name = Symbol.for("TW.Name");

  export const Meta = Symbol.for("TW.Meta");

  export const InputSchema = Symbol.for("TW.InputSchema");

  export const Step = Symbol.for("TW.Step");

  export const Scope = Symbol.for("TW.Ctx");

  /** Stores language-model providers in an actor's internal scope. */
  export const Provider = Symbol.for("TW.Provider");

  export interface AIProviderRegistration<
    Name extends string = string,
    Models extends readonly string[] = readonly string[],
    Model = unknown
  > {
    readonly provider: Lowercase<Name>;
    readonly models: Models;
    readonly model: (modelId: Models[number]) => Model;
  }

  export interface AIProvider<
    Name extends string = string,
    Models extends readonly string[] = readonly string[],
    Model = unknown
  > extends AIProviderRegistration<Name, Models, Model> {
    readonly [Scope]: {
      readonly [Provider]: Record<
        Name,
        AIProviderRegistration<Name, Models, Model>
      >;
    };
  }

  export const Listeners = Symbol.for("TW.Listeners");

  export const Type = Symbol.for("TW.Type");

  /** Identifies an actor-state value by its state path. */
  export const State = Symbol.for("TW.State");

  /** Exposes actor-owned state values to TaskWish runtime integrations. */
  export const States = Symbol.for("TW.States");

  /** Lets an extension bind a value to an actor's scope. */
  export const ActorScope = Symbol.for("TW.ActorScope");

  /** Lets a scoped value observe an action and publish events while it runs. */
  export const ActionObserver = Symbol.for("TW.ActionObserver");

  export const Branch: unique symbol = Symbol.for("TW.Branch") as never;

  export interface Contextual<Ctx extends Record<any, any>> {
    [Scope]: Ctx["scope"];
  }

  export interface Named<Name extends string> {
    [Name]: Name;
  }

  export interface Attributable<Meta> {
    [Meta]: Meta;
  }

  export interface Resource<Name extends string> extends Named<Name> {}

  export type Configurable<Type> = Type;

  export abstract class Handler {
    readonly ctx!: Record<"model", unknown>;
    run?: (...x: never[]) => Promise<any>;
  }

  type EventKindNames<S> = {
    [K in keyof S]: S[K] extends EventKind<infer Name, any, any> ? Name : never;
  }[keyof S];

  type EventKindForName<S, Name extends string> = {
    [K in keyof S]: S[K] extends EventKind<infer EventName, any, any>
      ? Name extends EventName
        ? S[K]
        : never
      : never;
  }[keyof S];

  type EventKindData<S, K extends string> = EventKindForName<
    S,
    K
  > extends EventKind<any, infer D, any>
    ? UnionData<D> extends Record<string, unknown>
      ? UnionData<D>
      : Record<string, unknown>
    : Record<string, unknown>;

  type EventKindName<S, K extends string> = EventKindForName<
    S,
    K
  > extends EventKind<infer N extends string, any, any>
    ? N
    : K;

  type StripBranch<T> = T extends Branch<any, any, infer Runtime> ? Runtime : T;

  type UserScope<S> = {
    [K in keyof StripEventKinds<S> as K extends typeof Branch
      ? never
      : K extends typeof Provider
      ? never
      : K]: StripBranch<StripEventKinds<S>[K]>;
  };

  export type Scope<S> = UserScope<S> & {
    abortSignal?: Configurable<AbortSignal>;
    self: <Return = any>(
      input: S extends Record<any, any> ? UnionData<S["input"]> : never
    ) => Return;
    signal<
      T extends [EventKindNames<S>] extends [never] ? string : EventKindNames<S>
    >(
      type: T,
      data: EventKindData<S, T & string>
    ): AsyncGenerator<
      Signal<EventKindName<S, T & string>, EventKindData<S, T & string>>,
      Signal<
        EventKindName<S, T & string>,
        EventKindData<S, T & string>
      >["data"],
      unknown
    >;
  };

  export type Inject<Type> = Type | null;

  export type StepEvent<Result = unknown> =
    | Trace<string, { result: Result }>
    | Trace<string, { error: unknown }>;

  export type ActionEvent<
    Name extends string,
    Result = unknown,
    Input = unknown
  > =
    | Trace<Name, { input: Input }>
    | Trace<Name, { result: Result }>
    | Trace<Name, { error: unknown }>;

  export type Branch<Input, Result, Runtime = Result> = Runtime & {
    readonly [Branch]: {
      input: Input;
      result: Result;
    };
  };

  export class Union<Data> {
    #data: Data;

    constructor(data: Data) {
      this.#data = data;
    }

    unwrap(): Data {
      return this.#data;
    }
  }

  type UnionToIntersection<U> = (
    U extends unknown ? (value: U) => void : never
  ) extends (value: infer I) => void
    ? I
    : never;

  type OverloadedHandler<Handler extends (...args: any) => any> =
    UnionToIntersection<Handler> extends infer Overloaded extends (
      ...args: any
    ) => any
      ? Overloaded
      : never;

  export type Action<
    Name extends string,
    Handler extends (...args: any) => any,
    Meta = null
  > = OverloadedHandler<NoInfer<Handler>> &
    ActionRuntime<Name, OverloadedHandler<NoInfer<Handler>>> & {
      ctx(
        context?: ActionContext<ActionContextScopeFromMeta<Meta>>
      ): ActionRuntime<Name, OverloadedHandler<NoInfer<Handler>>>;
    } & Resource<Name> &
    Attributable<Meta>;

  export type ActionCtxMeta<Meta, Ctx extends Record<any, any>> = keyof Omit<
    Ctx,
    "abortSignal"
  > extends never
    ? Meta
    : Pretty<(Meta extends null ? {} : Meta) & { ctx: Ctx }>;

  type ActionContextScopeFromMeta<Meta> = Meta extends {
    ctx: infer Ctx extends Record<any, any>;
  }
    ? Ctx
    : { abortSignal?: Configurable<AbortSignal> };

  export type ActionContext<
    Ctx extends Record<any, any> = {
      abortSignal?: Configurable<AbortSignal>;
    }
  > = AbortSignal | Ctx;

  export type ActionRuntime<
    Name extends string,
    Handler extends (...args: any) => any
  > = {
    run: NoInfer<Handler>;
    stream: ((
      ...args: Parameters<NoInfer<Handler>>
    ) => AsyncGenerator<
      ActionEvent<Name, StreamResult<Handler>, StreamInput<Handler>>,
      StreamResult<Handler>
    >) &
      NoInfer<Handler>;
  };

  export interface Execution<Stream, Return, Deps, Params = null>
    extends AsyncGenerator<Stream, Return, Deps>,
      Promise<Return> {
    id: Inject<UUIDv7String>;
    eventId: Inject<UUIDv7String>;
    params: Params;
  }

  export type Service<
    Name extends string,
    Actions,
    ServiceScope = {}
  > = OmitListeners<Actions> & {
    [Name]: Name;
    [Listeners]: PickListeners<Actions>;
    [Scope]: ServiceScope;
  };

  export interface Log<Data> {
    id: Inject<UUIDv7String>;
    eventId: Inject<UUIDv7String>;
    data: Data;
    toString: () => string;
  }

  export interface Exception<Status extends number, Data> {
    id: Inject<UUIDv7String>;
    eventId: Inject<UUIDv7String>;
    status: Status;
    data?: Data;
    throw: () => void;
    toString: () => string;
  }

  export interface EventKind<Name extends string, Data, Meta = null>
    extends Resource<Name>,
      Attributable<Meta> {
    readonly "~data"?: Data;
    emit(
      data: UnionData<Data>
    ): AsyncGenerator<
      Signal<Name, UnionData<Data>>,
      Signal<Name, UnionData<Data>>,
      unknown
    >;
  }

  export type Struct<Name extends string, TypeDef> = ArkType<TypeDef> &
    Resource<Name>;

  /** A mutable actor-scoped value created with State(...). */
  export type State<Value> = Value;

  export interface Extendable<Scope> {
    use<const NewScope>(newScope: NewScope): Extendable<Scope & NewScope>;
  }

  export interface Triggerable<Ctx extends Record<any, any>> {
    on<const Schema>(
      trigger: ValidateTrigger<Schema>
    ): Contextual<Ctx & InferTriggerScope<Schema>>;
  }

  export interface ResourceKind<Name extends string> extends Named<Name> {}

  export type Step<
    Name extends string,
    Handler extends (...args: any) => any
  > = ReturnType<Handler> extends AsyncGenerator<infer Caller, any, any>
    ? [Extract<Caller, Trace<string, { input: any }>>] extends [never]
      ? ScriptStep<Name, Handler>
      : Extract<Caller, Trace<string, { input: any }>> extends Trace<
          infer ActionName,
          { input: infer P }
        >
      ? ActionStep<Name, ActionName, P>
      : ScriptStep<Name, Handler>
    : ScriptStep<Name, Handler>;

  export interface ScriptStep<
    Name extends string,
    _Handler extends (...args: any) => any
  > {
    $: "step";
    "=": Name;
    run: string;
  }

  export type ActionStep<
    Name extends string,
    ActionName extends string,
    Params
  > = {
    $: ActionName;
    "=": Name;
  } & Params;
}
