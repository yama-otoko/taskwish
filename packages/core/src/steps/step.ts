import { FindInferTypeFilter, PrettyScope, RawEntry, ResolveScope } from "../helpers";
import { TW } from "../core";

type BranchLike = {
  readonly [TW.Branch]: {
    input: unknown;
    result: unknown;
  };
};

type ResolveReturnValue<T> = T extends BranchLike
  ? T
  : Awaited<T> extends AsyncGenerator<any, infer R, any>
    ? Awaited<R>
    : Awaited<T> extends Generator<any, infer R, any>
      ? R
      : Awaited<T>;

type ResolveReturn<H extends (...args: any) => any> = ResolveReturnValue<
  ReturnType<H>
>;

type IsAny<T> = 0 extends 1 & T ? true : false;

type LowercaseLetter =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z";

type UppercaseLetter = Uppercase<LowercaseLetter>;
type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
type StepNameCharacter = LowercaseLetter | UppercaseLetter | Digit;

type ContainsOnlyStepNameCharacters<Value extends string> =
  Value extends ""
    ? true
    : Value extends `${StepNameCharacter}${infer Rest}`
      ? ContainsOnlyStepNameCharacters<Rest>
      : false;

type CamelCaseStepName<Value extends string> = string extends Value
  ? Value
  : Value extends `${LowercaseLetter}${infer Rest}`
    ? ContainsOnlyStepNameCharacters<Rest> extends true
      ? Value
      : never
    : never;

type ValidStepName<Value> = Value extends readonly ["|>", infer PipeName]
  ? PipeName extends string
    ? CamelCaseStepName<PipeName> extends never
      ? never
      : Value
    : never
  : Value extends string
    ? CamelCaseStepName<Value>
    : never;

type ResolveYields<H extends (...args: any) => any> = IsAny<
  ReturnType<H>
> extends true
  ? never
  : Awaited<ReturnType<H>> extends AsyncGenerator<infer Y, any, any>
  ? Y
  : Awaited<ReturnType<H>> extends Generator<infer Y, any, any>
  ? Y
  : never;

export type StepScope<Ctx extends Record<any, any>> = PrettyScope<
  TW.Scope<ResolveScope<Ctx["scope"]>>
>;

export type StepDefinition<
  Name extends string,
  Ctx extends Record<any, any>,
  Result,
> = {
  [TW.Step]: (ctx: Ctx) => {
    name: Ctx["name"];
    steps: Ctx extends { steps: infer Steps extends any[] }
      ? [...Steps, TW.Step<Name, () => Promise<Result>>]
      : [TW.Step<Name, () => Promise<Result>>];
    step: Ctx["step"];
    scope: Record<Name, RawEntry<Result>> & Ctx["scope"];
    last: RawEntry<Result>;
    plugins: Ctx["plugins"];
  };
};

export function Step<
  Ctx extends Record<any, any>,
  const NameParm extends "name" extends keyof Ctx["step"]
    ? Ctx["step"]["name"] | readonly ["|>", string]
    : string | readonly ["|>", string],
  const Handler extends Name extends keyof Ctx["step"]["map"]
    ? Ctx["step"]["map"][Name]
    : (
        this: StepScope<Ctx>,
        source: Ctx["last"]["yields"] extends never
          ? Ctx["last"]["result"]
          : AsyncIterable<Ctx["last"]["yields"]>,
      ) => any,
  const Params extends Name extends keyof Ctx["step"]["map"]
    ? Ctx["step"]["map"][Name]
    : never,
  const Name extends string = NameParm extends readonly ["|>", infer PipeName]
    ? PipeName
    : NameParm,
>(
  name: NameParm & ValidStepName<NameParm>,
  handler: Name extends keyof Ctx["step"]["map"] ? Params : Handler,
): {
  [TW.Step]: (ctx: Ctx) => {
    name: Ctx["name"];
    steps: Ctx extends { steps: infer L extends any[] }
      ? Name extends keyof Ctx["step"]["map"]
        ? L
        : [
            ...L,
            TW.Step<
              Name,
              FindInferTypeFilter<Ctx["plugins"]> extends infer Filter
                ? [Filter] extends [never]
                  ? () => ReturnType<Handler>
                  : Filter extends string
                  ? Filter extends Name
                    ? Handler
                    : () => ReturnType<Handler>
                  : Handler
                : () => ReturnType<Handler>
            >,
          ]
      : Name extends keyof Ctx["step"]["map"]
      ? []
      : [TW.Step<Name, () => ReturnType<Handler>>];
    step: Ctx["step"];
    scope: Record<
      Name,
      RawEntry<
        Name extends keyof Ctx["step"]["map"] ? string : ResolveReturn<Handler>,
        [],
        ResolveYields<Handler>
      >
    > &
      Ctx["scope"];
    last: RawEntry<ResolveReturn<Handler>, [], ResolveYields<Handler>>;
    plugins: Ctx["plugins"];
  };
};

export function Step<
  Ctx extends Record<any, any>,
  const Name extends "name" extends keyof Ctx["step"]
    ? Ctx["step"]["name"]
    : string,
  const Handler extends Name extends keyof Ctx["step"]["map"]
    ? Ctx["step"]["map"][Name]
    : (this: StepScope<Ctx>) => any,
  const Params extends Name extends keyof Ctx["step"]["map"]
    ? Ctx["step"]["map"][Name]
    : never,
  A,
>(
  name: Name & ValidStepName<Name>,
  handler: [
    Name extends keyof Ctx["step"]["map"] ? Params : Handler,
    (
      res: Name extends keyof Ctx["step"]["map"]
        ? string
        : ResolveReturn<Handler>,
    ) => A,
  ],
): {
  [TW.Step]: (ctx: Ctx) => {
    name: Ctx["name"];
    steps: Ctx extends { steps: infer L extends any[] }
      ? [...L, TW.Step<Name, () => ReturnType<Handler>>]
      : [TW.Step<Name, () => ReturnType<Handler>>];
    step: Ctx["step"];
    scope: Record<Name, RawEntry<A, [], ResolveYields<Handler>>> & Ctx["scope"];
    last: RawEntry<ResolveReturn<Handler>, [], ResolveYields<Handler>>;
    plugins: Ctx["plugins"];
  };
};

export function Step<
  Ctx extends Record<any, any>,
  const Name extends "name" extends keyof Ctx["step"]
    ? Ctx["step"]["name"]
    : string,
  const Handler extends Name extends keyof Ctx["step"]["map"]
    ? Ctx["step"]["map"][Name]
    : (this: StepScope<Ctx>) => any,
  const Params extends Name extends keyof Ctx["step"]["map"]
    ? Ctx["step"]["map"][Name]
    : never,
  A,
  B,
>(
  name: Name & ValidStepName<Name>,
  handler: [
    Name extends keyof Ctx["step"]["map"] ? Params : Handler,
    (
      res: Name extends keyof Ctx["step"]["map"]
        ? string
        : ResolveReturn<Handler>,
    ) => A,
    (input: A) => B,
  ],
): {
  [TW.Step]: (ctx: Ctx) => {
    name: Ctx["name"];
    steps: Ctx extends { steps: infer L extends any[] }
      ? [...L, TW.ScriptStep<Name, () => ReturnType<Handler>>]
      : [TW.ScriptStep<Name, () => ReturnType<Handler>>];
    step: Ctx["step"];
    scope: Record<Name, RawEntry<B, [], ResolveYields<Handler>>> & Ctx["scope"];
    last: RawEntry<ResolveReturn<Handler>, [], ResolveYields<Handler>>;
    plugins: Ctx["plugins"];
  };
};

export function Step(name?: unknown, handler?: unknown) {
  if (name === undefined || handler === undefined) return {} as never;
  const stepName = Array.isArray(name) && name[0] === "|>" ? name[1] : name;
  if (typeof stepName !== "string" || !/^[a-z][a-zA-Z0-9]*$/.test(stepName)) {
    throw new Error(
      `Step name "${String(stepName)}" must use lower camelCase.`,
    );
  }
  return Object.assign(handler as any, {
    [TW.Name]: name,
  }) as never;
}
