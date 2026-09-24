import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { scope, type } from "arktype";
import { TW } from "@taskwish/core";
import { Wind } from "@taskwish/wind";

type InferSchema<Schema, Scope = {}> = Schema extends StandardSchemaV1<
  infer Input
>
  ? Input
  : type.instantiate<Schema, Scope>["infer"];

type Pretty<Value> = { [Key in keyof Value]: Value[Key] } & {};

const StateDefinition = Symbol("Taskwish.StateDefinition");
const StateListDefinition = Symbol("Taskwish.StateListDefinition");
const StateValueDefinition = Symbol("Taskwish.StateValueDefinition");
const StateStoreDefinition = Symbol("Taskwish.StateStoreDefinition");
const StateColumns = Symbol("Taskwish.StateColumns");

const stateScope = scope({
  primary: scope({
    uuidv4: scope({
      random: "string.uuid.v4",
    }).export(),
  }).export(),
});

type StateScope = typeof stateScope.t;

type StateListDescriptor<Schema = unknown> = {
  readonly [StateListDefinition]: true;
  readonly schema: Schema;
};

type PrimaryRandomUUID = "primary.uuidv4.random";

type StateListTypeSchema<Schema> = Schema extends Record<string, unknown>
  ? {
      [Key in keyof Schema]: Schema[Key] extends PrimaryRandomUUID
        ? "string.uuid.v4"
        : Schema[Key];
    }
  : Schema;

type StateType<Path extends string> = {
  readonly [TW.State]: `state${Path extends "" ? "" : `.${Path}`}`;
};

type StateListItem<Schema> = InferSchema<StateListTypeSchema<Schema>>;

type PrimaryRandomKeys<Schema> = Schema extends Record<string, unknown>
  ? {
      [Key in keyof Schema]: Schema[Key] extends PrimaryRandomUUID
        ? Key
        : never;
    }[keyof Schema]
  : never;

type WithOptionalKeys<Value, Keys extends PropertyKey> = Value extends object
  ? Omit<Value, Extract<keyof Value, Keys>> &
      Partial<Pick<Value, Extract<keyof Value, Keys>>>
  : Value;

type StateListInput<Schema> = WithOptionalKeys<
  InferSchema<StateListTypeSchema<Schema>>,
  PrimaryRandomKeys<Schema>
>;

interface StateListValue<Item, Input, Path extends string = string>
  extends Array<Item>,
    StateType<Path> {
  push(...items: Item[]): number;
  push(...items: Input[]): number;
  unshift(...items: Item[]): number;
  unshift(...items: Input[]): number;
}

type StateScalar = string | number | boolean;

type WidenStateScalar<Value extends StateScalar> = Value extends string
  ? string
  : Value extends number
  ? number
  : boolean;

type StateFieldsValue<Fields> = Pretty<{
  -readonly [Key in keyof Fields]: Fields[Key] extends StateListDescriptor<
    infer Schema
  >
    ? StateListValue<
        StateListItem<Schema>,
        StateListInput<Schema>,
        Key & string
      >
    : Fields[Key] extends StateScalar
    ? WidenStateScalar<Fields[Key]>
    : never;
}>;

type StateValue<Fields> = StateFieldsValue<Fields> & StateType<"">;

type ValidateStateFields<Fields> = {
  [Key in keyof Fields]: Fields[Key] extends StateListDescriptor
    ? Fields[Key]
    : Fields[Key] extends StateScalar
    ? Fields[Key]
    : `State field "${Key &
        string}" must be a primitive initial value or declared with State.List(...)`;
};

type StateResult<Fields, Ctx extends Record<any, any>> = {
  state: StateValue<Fields>;
  [TW.Step]: (ctx: Ctx) => {
    name: Ctx["name"];
    steps: Ctx["steps"];
    step: Ctx["step"];
    scope: { state: StateValue<Fields> } & Ctx["scope"];
    last: { state: StateValue<Fields> };
    plugins: Ctx["plugins"];
  };
};

type PreserveContext<Ctx extends Record<any, any>> = {
  name: Ctx["name"];
  steps: Ctx["steps"];
  step: Ctx["step"];
  scope: Ctx["scope"];
  last: Ctx["last"];
  plugins: Ctx["plugins"];
};

type StateStoreResult<Ctx extends Record<any, any>> = {
  [TW.Step]: (ctx: Ctx) => PreserveContext<Ctx>;
};

export interface StateStore {
  /** Loads the actor's state. */
  load(actorName: string): unknown | undefined;
  /** Saves the actor's state. */
  save(actorName: string, state: Record<string, unknown>): void;
}

export type StoreOptions = {
  adapter: "fs";
  /** Defaults to `TW_DEFAULT_STORE_PATH`, then `<cwd>/state`. */
  directory?: string;
};

type RuntimeListDescriptor = StateListDescriptor & {
  validator: { assert(input: unknown): unknown };
};

type RuntimeValueDescriptor = {
  [StateValueDefinition]: true;
  initial: StateScalar;
  validator: { assert(input: unknown): unknown };
};

type RuntimeFieldDescriptor = RuntimeListDescriptor | RuntimeValueDescriptor;

type RuntimeState = Record<string, unknown>;

function expandStateListSchema(schema: unknown): unknown {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    return schema;
  }

  return Object.fromEntries(
    Object.entries(schema).map(([key, definition]) => [
      key,
      definition === "primary.uuidv4.random"
        ? [definition, "=", () => randomUUID()]
        : definition,
    ])
  );
}

type RuntimeDefinition = {
  [StateDefinition]: true;
  [TW.ActorScope](actorName: string, steps: readonly unknown[]): RuntimeState;
  fields: Record<string, RuntimeFieldDescriptor>;
  instances: Map<string, RuntimeState>;
};

export type StateChange = {
  path: string;
  previous: unknown;
  value: unknown;
  columns?: string[];
};

export type StateSnapshot = Array<{
  state: RuntimeState;
  values: Record<string, unknown>;
}>;

type RuntimeStore = {
  [StateStoreDefinition]: true;
  [TW.ActorScope]: true;
  store: StateStore;
};

export type StatePayload = {
  path: string;
  value: unknown;
  columns?: string[];
};

function cloneStateValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function restoreArray(target: unknown[], snapshot: unknown[]): void {
  target.length = 0;
  target.push(...snapshot);
}

function defineStateMetadata(
  value: object,
  path: string,
  columns?: string[]
): void {
  Object.defineProperty(value, TW.State, {
    configurable: true,
    value: path,
  });
  if (columns) {
    Object.defineProperty(value, StateColumns, {
      configurable: true,
      value: columns,
    });
  }
}

function annotateStateValue(
  value: unknown,
  path: string,
  columns?: string[]
): void {
  if (value === null || typeof value !== "object") return;

  defineStateMetadata(value, path, columns);
  if (Array.isArray(value)) {
    for (const item of value) annotateStateValue(item, path, columns);
  }
}

function stateFieldColumns(
  descriptor: RuntimeFieldDescriptor
): string[] | undefined {
  if (!(StateListDefinition in descriptor)) return undefined;
  return descriptor.schema !== null &&
    typeof descriptor.schema === "object" &&
    !Array.isArray(descriptor.schema)
    ? Object.keys(descriptor.schema)
    : undefined;
}

function annotateState(
  state: RuntimeState,
  definition: RuntimeDefinition
): void {
  defineStateMetadata(state, "state", Object.keys(definition.fields));
  for (const [field, descriptor] of Object.entries(definition.fields)) {
    annotateStateValue(
      state[field],
      `state.${field}`,
      stateFieldColumns(descriptor)
    );
  }
}

export function statePayload(value: unknown): StatePayload | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string | symbol, unknown>;
  const path = record[TW.State];
  if (typeof path !== "string" || !/^state(?:\.|$)/.test(path)) return null;
  const columns = record[StateColumns];

  return {
    path,
    value,
    ...(Array.isArray(columns) ? { columns: columns as string[] } : {}),
  };
}

export function captureStateSnapshot(
  scope: Record<string | symbol, unknown>
): StateSnapshot {
  const snapshots: StateSnapshot = [];
  const seen = new Set<object>();

  for (const value of Object.values(scope)) {
    if (value === null || typeof value !== "object" || seen.has(value)) {
      continue;
    }
    const record = value as RuntimeState & Record<symbol, unknown>;
    if (record[TW.State] !== "state") continue;
    seen.add(value);
    snapshots.push({
      state: record,
      values: Object.fromEntries(
        Object.keys(record).map((field) => [
          field,
          cloneStateValue(record[field]),
        ])
      ),
    });
  }

  return snapshots;
}

export function stateChangesSince(snapshot: StateSnapshot): StateChange[] {
  const changes: StateChange[] = [];

  for (const { state, values } of snapshot) {
    for (const field of Object.keys(values)) {
      const previous = values[field];
      const value = cloneStateValue(state[field]);
      if (JSON.stringify(previous) === JSON.stringify(value)) continue;
      const payload = statePayload(state[field]);

      changes.push({
        path: `state.${field}`,
        previous,
        value,
        ...(payload?.columns ? { columns: payload.columns } : {}),
      });
    }
  }

  return changes;
}

function safeActorName(actorName: string): string {
  const safe = actorName.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return safe || "actor";
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read state from ${path}`, { cause: error });
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new TypeError(`State for ${path} is not JSON serializable`);
  }
  writeFileSync(temporaryPath, `${serialized}\n`, "utf8");
  renameSync(temporaryPath, path);
}

function fileSystemStateStore(
  options: Omit<StoreOptions, "adapter"> = {}
): StateStore {
  const directory = resolve(
    options.directory ??
      process.env.TW_DEFAULT_STORE_PATH ??
      join(process.cwd(), "state")
  );

  return {
    load(actorName) {
      mkdirSync(directory, { recursive: true });
      const name = safeActorName(actorName);
      const path = join(directory, `${name}.json`);

      if (existsSync(path)) return readJson(path);
      return undefined;
    },
    save(actorName, state) {
      mkdirSync(directory, { recursive: true });
      const name = safeActorName(actorName);
      writeJsonAtomic(join(directory, `${name}.json`), state);
    },
  };
}

function observable<T extends object>(
  value: T,
  onChange: () => void,
  proxies = new WeakMap<object, object>()
): T {
  const existing = proxies.get(value);
  if (existing) return existing as T;

  let transactionDepth = 0;
  const arrayMutators = new Set<PropertyKey>([
    "copyWithin",
    "fill",
    "pop",
    "push",
    "reverse",
    "shift",
    "sort",
    "splice",
    "unshift",
  ]);
  const arrayDerivers = new Set<PropertyKey>([
    "concat",
    "filter",
    "flat",
    "flatMap",
    "map",
    "slice",
    "toReversed",
    "toSorted",
    "toSpliced",
    "with",
  ]);

  const proxy = new Proxy(value, {
    get(target, property, receiver) {
      const result = Reflect.get(target, property, receiver);

      if (
        Array.isArray(target) &&
        arrayMutators.has(property) &&
        typeof result === "function"
      ) {
        return (...args: unknown[]) => {
          const snapshot = target.slice();
          transactionDepth += 1;
          try {
            const output = Reflect.apply(result, receiver, args);
            if (transactionDepth === 1) onChange();
            return output;
          } catch (error) {
            restoreArray(target, snapshot);
            throw error;
          } finally {
            transactionDepth -= 1;
          }
        };
      }

      if (
        Array.isArray(target) &&
        arrayDerivers.has(property) &&
        typeof result === "function"
      ) {
        return (...args: unknown[]) => {
          const derived = Reflect.apply(result, receiver, args);
          if (Array.isArray(derived)) {
            const path = (target as Record<symbol, unknown>)[TW.State];
            const columns = (target as Record<symbol, unknown>)[StateColumns];
            if (typeof path === "string") {
              annotateStateValue(
                derived,
                path,
                Array.isArray(columns) ? (columns as string[]) : undefined
              );
            }
          }
          return derived;
        };
      }

      return result !== null && typeof result === "object"
        ? observable(result, onChange, proxies)
        : result;
    },
    set(target, property, next, receiver) {
      const previous = Reflect.get(target, property, receiver);
      const changed = previous !== next;
      if (!changed) return true;
      const existed = Reflect.has(target, property);
      try {
        const didSet = Reflect.set(target, property, next, receiver);
        if (didSet && transactionDepth === 0) onChange();
        return didSet;
      } catch (error) {
        if (existed) {
          Reflect.set(target, property, previous, target);
        } else {
          Reflect.deleteProperty(target, property);
        }
        throw error;
      }
    },
    deleteProperty(target, property) {
      const existed = Reflect.has(target, property);
      if (!existed) return true;
      const previous = Reflect.get(target, property);
      try {
        const deleted = Reflect.deleteProperty(target, property);
        if (deleted && transactionDepth === 0) onChange();
        return deleted;
      } catch (error) {
        Reflect.set(target, property, previous, target);
        throw error;
      }
    },
  });

  proxies.set(value, proxy);
  return proxy;
}

function validateState(
  fields: Record<string, RuntimeFieldDescriptor>,
  state: RuntimeState
): void {
  for (const [field, descriptor] of Object.entries(fields)) {
    const value = state[field];
    if (StateListDefinition in descriptor) {
      if (!Array.isArray(value)) {
        throw new TypeError(`State field "${field}" must be an array`);
      }

      for (let index = 0; index < value.length; index += 1) {
        try {
          const input = value[index];
          const output = descriptor.validator.assert(input);

          if (
            input !== output &&
            input !== null &&
            output !== null &&
            typeof input === "object" &&
            typeof output === "object" &&
            !Array.isArray(input) &&
            !Array.isArray(output)
          ) {
            for (const key of Object.keys(input)) {
              if (!(key in output)) delete (input as RuntimeState)[key];
            }
            Object.assign(input, output);
          } else {
            value[index] = output;
          }
        } catch (error) {
          throw new TypeError(
            `Invalid value at state.${field}[${index}]: ${String(error)}`,
            { cause: error }
          );
        }
      }
      continue;
    }

    try {
      descriptor.validator.assert(value);
    } catch (error) {
      throw new TypeError(`Invalid value at state.${field}: ${String(error)}`, {
        cause: error,
      });
    }
  }
}

function initialStateValue(descriptor: RuntimeFieldDescriptor): unknown {
  if (StateListDefinition in descriptor) return [];
  return descriptor.initial;
}

function createStateInstance(
  definition: RuntimeDefinition,
  actorName: string,
  store: StateStore
): RuntimeState {
  const stored = store.load(actorName) ?? {};
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) {
    throw new TypeError(`Stored state for ${actorName} must be an object`);
  }

  const rawState: RuntimeState = {};
  for (const [field, descriptor] of Object.entries(definition.fields)) {
    const value = (stored as RuntimeState)[field];
    rawState[field] =
      value === undefined ? initialStateValue(descriptor) : value;
  }
  validateState(definition.fields, rawState);
  annotateState(rawState, definition);

  Object.defineProperty(rawState, TW.ActionObserver, {
    configurable: true,
    value(actionName: string) {
      const snapshot = captureStateSnapshot({ state: rawState });
      return () => {
        const actor = actionName.includes("::")
          ? actionName.slice(0, actionName.indexOf("::"))
          : "";

        return stateChangesSince(snapshot).map(
          (change) =>
            new Wind.StateChange(
              [actor, change.path].filter(Boolean).join("::"),
              Object.fromEntries(
                Object.entries(change).filter(([key]) => key !== "path")
              )
            )
        );
      };
    },
  });

  let state!: RuntimeState;
  const persist = () => {
    validateState(definition.fields, rawState);
    annotateState(rawState, definition);
    const raw = Object.fromEntries(
      Object.keys(definition.fields).map((field) => [field, rawState[field]])
    );
    store.save(actorName, raw);
  };

  state = observable(rawState, persist);
  return state;
}

export function isStateDefinition(value: unknown): value is RuntimeDefinition {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as Partial<RuntimeDefinition>)[StateDefinition] === true
  );
}

export function isStateStore(value: unknown): value is RuntimeStore {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as Partial<RuntimeStore>)[StateStoreDefinition] === true
  );
}

export function bindStateDefinition(
  definition: RuntimeDefinition,
  actorName: string,
  runtimeStore?: RuntimeStore
): RuntimeState {
  const existing = definition.instances.get(actorName);
  if (existing) return existing;

  const state = createStateInstance(
    definition,
    actorName,
    runtimeStore?.store ?? fileSystemStateStore()
  );
  definition.instances.set(actorName, state);
  return state;
}

interface StateFactory {
  <
    const Fields extends Record<string, unknown>,
    Ctx extends Record<any, any> = { scope: {} }
  >(
    fields: Fields & ValidateStateFields<Fields>
  ): StateResult<Fields, Ctx>;

  List<const Schema>(
    schema: type.validate<Schema, StateScope>
  ): StateListDescriptor<Schema>;
}

export function Store<Ctx extends Record<any, any> = { scope: {} }>(
  options: StoreOptions
): StateStoreResult<Ctx> {
  switch (options.adapter) {
    case "fs":
      return {
        [StateStoreDefinition]: true,
        [TW.ActorScope]: true,
        store: fileSystemStateStore(options),
      } as unknown as StateStoreResult<Ctx>;
  }
}

export const State: StateFactory = Object.assign(
  (fieldsDefinition: Record<string, unknown>) => {
    const fields: Record<string, RuntimeFieldDescriptor> = {};
    for (const [field, definition] of Object.entries(fieldsDefinition)) {
      if (
        definition !== null &&
        typeof definition === "object" &&
        StateListDefinition in definition
      ) {
        fields[field] = definition as RuntimeListDescriptor;
        continue;
      }

      if (
        typeof definition === "string" ||
        typeof definition === "number" ||
        typeof definition === "boolean"
      ) {
        const domain = typeof definition as "string" | "number" | "boolean";
        fields[field] = {
          [StateValueDefinition]: true,
          initial: definition,
          validator: stateScope.type(domain),
        };
        continue;
      }

      throw new TypeError(
        `State field "${field}" must be a primitive initial value or declared with State.List(...)`
      );
    }

    const definition: RuntimeDefinition = {
      [StateDefinition]: true,
      [TW.ActorScope](
        actorName: string,
        steps: readonly unknown[]
      ): RuntimeState {
        const runtimeStore = steps.find(isStateStore);
        return bindStateDefinition(definition, actorName, runtimeStore);
      },
      fields,
      instances: new Map(),
    };

    return {
      state: definition,
    };
  },
  {
    List(schema: unknown) {
      return {
        [StateListDefinition]: true,
        schema,
        validator: stateScope.type(expandStateListSchema(schema) as never),
      };
    },
  }
) as unknown as StateFactory;
