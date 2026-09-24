import { type Constructor, type array, type conform } from "@ark/util";
import { distill, type Type as ArkType, type } from "arktype";
import type { Morph, NodeSelector, Predicate, TypeMeta } from "@ark/schema";

import {
  InferSchema,
  PascalCase,
  Pretty,
  QualifiedEventName,
} from "../helpers";
import { TW } from "../core";
import { Signal } from "@taskwish/wind";

type ArgTwoOperator = "[]" | "&" | "|" | "|>" | ":" | "=>" | "@";
type IndexZeroOperator = "keyof" | "instanceof" | "===";
type TupleInfixOperator = "&" | "|" | "|>" | ":" | "=>" | "@" | "=";

type EventSpec<Name extends string> =
  Name extends `${infer Actor}::${infer Event}`
    ? `${PascalCase<Actor>}::${PascalCase<Event>}`
    : Name extends `${infer Actor}:${infer Event}`
    ? `${PascalCase<Actor>}:${PascalCase<Event>}`
    : PascalCase<Name>;

type EventRuntimeName<Name extends string> =
  Name extends `${infer Actor}::${infer Event}`
    ? QualifiedEventName<Actor, Event>
    : Name extends `${infer Actor}:${infer Event}`
    ? QualifiedEventName<Actor, Event>
    : Name;

type EventOptions<Name extends string, Command extends string = string> = {
  name: EventSpec<Name>;
  command: Command;
};

type ScopedEventName<
  Actor extends string,
  Name extends string
> = EventRuntimeName<Name> extends `${string}::${string}`
  ? EventRuntimeName<Name>
  : QualifiedEventName<Actor, Name>;

type NormalizeVoidSchema<Schema> = Schema extends "void"
  ? "undefined"
  : Schema extends readonly [infer Head, ...infer Tail]
  ? [NormalizeVoidSchema<Head>, ...NormalizeVoidSchema<Tail>]
  : Schema;

type HasVoidSchema<Schema> = Schema extends "void"
  ? true
  : Schema extends readonly [infer Head, ...infer Tail]
  ? HasVoidSchema<Head> extends true
    ? true
    : HasVoidSchema<Tail>
  : false;

type EventValidate<Schema, Scope> = Schema extends "void"
  ? Schema
  : type.validate<Schema, Scope>;

type IsUnion<Type, Whole = Type> = Type extends unknown
  ? [Whole] extends [Type]
    ? false
    : true
  : never;

type WrapUnion<Type> = true extends IsUnion<Type> ? TW.Union<Type> : Type;

type EventData<
  Schema,
  Scope,
  Inferred = InferSchema<NormalizeVoidSchema<Schema>, Scope>
> = WrapUnion<
  HasVoidSchema<Schema> extends true
    ? Exclude<Inferred, undefined> | void
    : Inferred
>;

type EventResult<
  Name extends string,
  Schema,
  Ctx extends Record<any, any>,
  Data = EventData<Schema, Ctx["scope"]>,
  Meta = null
> = Pretty<
  {
    [key in Name]: TW.EventKind<EventRuntimeName<Name>, Data, Meta>;
  } & {
    [TW.Step]: <StepCtx extends Ctx & Record<any, any>>(
      ctx: StepCtx
    ) => {
      name: StepCtx["name"];
      steps: StepCtx["steps"] &
        Record<
          Name,
          TW.EventKind<
            ScopedEventName<StepCtx["name"] & string, Name>,
            EventData<Schema, StepCtx["scope"]>,
            Meta
          >
        >;
      step: StepCtx["step"];
      scope: Record<
        Name,
        TW.EventKind<
          ScopedEventName<StepCtx["name"] & string, Name>,
          EventData<Schema, StepCtx["scope"]>,
          Meta
        >
      > &
        Omit<StepCtx["scope"], Name>;
      last: Record<
        Name,
        TW.EventKind<
          ScopedEventName<StepCtx["name"] & string, Name>,
          EventData<Schema, StepCtx["scope"]>,
          Meta
        >
      >;
    };
  }
>;

interface Event {
  <
    const Name extends string,
    const Schema = {},
    Ctx extends Record<any, any> = { scope: {} }
  >(
    type: EventSpec<Name>,
    data?: EventValidate<Schema, Ctx["scope"]>
  ): EventResult<Name, Schema, Ctx>;

  <
    const Name extends string,
    const Command extends string,
    const Schema = {},
    Ctx extends Record<any, any> = { scope: {} }
  >(
    type: EventOptions<Name, Command>,
    data?: EventValidate<Schema, Ctx["scope"]>
  ): EventResult<
    Name,
    Schema,
    Ctx,
    EventData<Schema, Ctx["scope"]>,
    { command: Command }
  >;

  <
    const Name extends string,
    const zero,
    const one,
    const rest extends array,
    Ctx extends Record<any, any> = { scope: {} },
    schema = [zero, one, ...rest],
    r = type.instantiate<NormalizeVoidSchema<schema>, Ctx["scope"]>
  >(
    type: EventSpec<Name>,
    _0: zero extends IndexZeroOperator
      ? zero
      : EventValidate<zero, Ctx["scope"]>,
    _1: zero extends "keyof"
      ? EventValidate<one, Ctx["scope"]>
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
        ? [EventValidate<rest[0], Ctx["scope"]>]
        : one extends "@"
        ? [TypeMeta.MappableInput, NodeSelector?]
        : [EventValidate<rest[0], Ctx["scope"]>]
      : []
  ): r extends infer _
    ? EventResult<
        Name,
        schema,
        Ctx,
        EventData<schema, Ctx["scope"], _ extends ArkType<infer T> ? T : _>
      >
    : never;

  <
    const Name extends string,
    const Command extends string,
    const zero,
    const one,
    const rest extends array,
    Ctx extends Record<any, any> = { scope: {} },
    schema = [zero, one, ...rest],
    r = type.instantiate<NormalizeVoidSchema<schema>, Ctx["scope"]>
  >(
    type: EventOptions<Name, Command>,
    _0: zero extends IndexZeroOperator
      ? zero
      : EventValidate<zero, Ctx["scope"]>,
    _1: zero extends "keyof"
      ? EventValidate<one, Ctx["scope"]>
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
        ? [EventValidate<rest[0], Ctx["scope"]>]
        : one extends "@"
        ? [TypeMeta.MappableInput, NodeSelector?]
        : [EventValidate<rest[0], Ctx["scope"]>]
      : []
  ): r extends infer _
    ? EventResult<
        Name,
        schema,
        Ctx,
        EventData<schema, Ctx["scope"], _ extends ArkType<infer T> ? T : _>,
        { command: Command }
      >
    : never;
}

export const Event: Event = ((
  eventType: string | { name: string; command?: string },
  ...schemaParts: unknown[]
) => {
  const name = typeof eventType === "string" ? eventType : eventType.name;
  const runtimeName =
    typeof name === "string" && name.includes("::")
      ? name
      : typeof name === "string" && name.includes(":")
      ? name.replace(":", "::")
      : name;
  const meta =
    typeof eventType === "object" && typeof eventType.command === "string"
      ? { command: eventType.command }
      : null;
  const inputSchema = schemaParts.length <= 1 ? schemaParts[0] : schemaParts;
  const eventKind: any = {
    [TW.Name]: runtimeName,
    [TW.Meta]: meta,
    [TW.InputSchema]: inputSchema,
    emit: async function* (signalData: unknown) {
      const signal = new Signal(eventKind[TW.Name], signalData);
      yield signal;
      return signal;
    },
  };
  return { [name]: eventKind } as any;
}) as never;
