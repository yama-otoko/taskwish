/* oxlint-disable no-unused-vars, no-unused-expressions -- Compile-time assertions intentionally have no runtime use. */

import { expect, test, describe, mock } from "bun:test";
import { ToCEL } from "@taskwish/expr";
import { Expect, Equal, RawEntry } from "../helpers";
import { Action } from "./action";
import { Actor } from "../actor";
import { TW } from "../core";
import { Step } from "../steps";
import { InferType } from "../use";
import {
  Logger,
  Message,
  Trace,
  formatEvent,
  messageLogData,
} from "@taskwish/wind";
import { Event } from "../event";

const eventDataList = (values: unknown[]) => values.map(messageLogData);

describe("Action", () => {
  test("no input — plain handler", async () => {
    const { healthz } = Action("healthz").run(function () {
      return { status: "ok" };
    });

    type T = typeof healthz;

    type check = Expect<
      Equal<TW.Action<"healthz", () => Promise<{ status: string }>, null>, T>
    >;

    expect(await healthz()).toEqual({ status: "ok" });
  });

  test("object schema input", async () => {
    const { hello } = Action("hello")
      .input({ name: "string" })

      .run(function () {
        return `Hello ${this.input.name}`;
      });

    type T = typeof hello;

    type check = Expect<
      Equal<
        TW.Action<"hello", (input: { name: string }) => Promise<string>, null>,
        T
      >
    >;

    expect(await hello({ name: "World" })).toEqual("Hello World");
  });

  test("use — accepts a single event definition for signal()", async () => {
    const { VoiceCall } = Event("VoiceCall", {
      callId: "string",
      from: "string",
    });

    const { announceCall } = Action("announceCall")
      .use(VoiceCall)

      .input({ callId: "string", from: "string" })

      .run(
        Step("voiceCall", function () {
          return this.signal("VoiceCall", {
            callId: this.input.callId,
            from: this.input.from,
          });
        }),
      );

    const yields: unknown[] = [];
    for await (const v of announceCall.stream({
      callId: "call-1",
      from: "Ada",
    })) {
      yields.push(v);
    }

    expect(eventDataList(yields)).toEqual([
      {
        ">>": "announceCall",
        input: { callId: "call-1", from: "Ada" },
      },
      {
        "->": "VoiceCall",
        data: { callId: "call-1", from: "Ada" },
      },
      {
        ">>": "announceCall.voiceCall",
        result: {
          event: "VoiceCall",
          data: { callId: "call-1", from: "Ada" },
        },
      },
      {
        ">>": "announceCall",
        result: {
          event: "VoiceCall",
          data: { callId: "call-1", from: "Ada" },
        },
      },
    ]);
  });

  test("step chain — yields each step, resolves to last", async () => {
    const { hello } = Action("hello")
      .input({ name: "string" })

      .run(
        Step("fistStep", function () {
          return this.input.name.length;
        }),

        Step("secondStep", function () {
          return this.fistStep > 0;
        }),
      );

    type T = typeof hello;

    type check = Expect<
      Equal<
        TW.Action<"hello", (input: { name: string }) => Promise<boolean>, null>,
        T
      >
    >;

    expect(await hello({ name: "World" })).toEqual(true);

    const yields: unknown[] = [];

    for await (const v of hello.stream({ name: "World" })) {
      yields.push(v);
    }

    expect(eventDataList(yields)).toEqual([
      { ">>": "hello", input: { name: "World" } },
      { ">>": "hello.fistStep", result: 5 },
      { ">>": "hello.secondStep", result: true },
      { ">>": "hello", result: true },
    ]);
  });

  test("TypeScript type input", async () => {
    const { tsAction } = Action("tsAction")
      .input<{ name: string }>()

      .run(async function () {
        return `Hello ${this.input.name}`;
      });

    type checkCallable = Expect<
      typeof tsAction extends (...args: any[]) => AsyncGenerator<any, any, any>
        ? false
        : true
    >;
    type checkStream = Expect<
      typeof tsAction.stream extends (input: {
        name: string;
      }) => AsyncGenerator<any, any, any>
        ? true
        : false
    >;
    type checkRunParams = Expect<
      Equal<Parameters<typeof tsAction.run>, [{ name: string }]>
    >;
    type checkRunResult = Expect<
      Equal<Awaited<ReturnType<typeof tsAction.run>>, string>
    >;

    expect(await tsAction({ name: "Test" })).toEqual("Hello Test");
    expect(await tsAction.run({ name: "Test" })).toEqual("Hello Test");
  });

  test("ctx binds context for run and stream", async () => {
    const controller = new AbortController();
    const { readAbortSignal } = Action("readAbortSignal")
      .input<{ name: string }>()

      .run(async function () {
        return {
          name: this.input.name,
          direct: this.abortSignal === controller.signal,
        };
      });

    type checkCtxRunParams = Expect<
      Equal<
        Parameters<ReturnType<typeof readAbortSignal.ctx>["run"]>,
        [{ name: string }]
      >
    >;
    type checkCtxRunResult = Expect<
      Equal<
        Awaited<ReturnType<ReturnType<typeof readAbortSignal.ctx>["run"]>>,
        {
          name: string;
          direct: boolean;
        }
      >
    >;

    expect(
      await readAbortSignal.ctx(controller.signal).run({ name: "Test" }),
    ).toEqual({ name: "Test", direct: true });

    const stream = readAbortSignal
      .ctx({ abortSignal: controller.signal })
      .stream({ name: "Stream" });
    let item = await stream.next();
    while (!item.done) item = await stream.next();

    expect(item.value).toEqual({
      name: "Stream",
      direct: true,
    });

    const { hasNoDefaultAbortSignal } = Action("hasNoDefaultAbortSignal").run(
      function () {
        return this.abortSignal === undefined;
      },
    );

    expect(await hasNoDefaultAbortSignal()).toBe(true);
  });

  test("ctx accepts scoped action overrides", async () => {
    const controller = new AbortController();
    const { actor } = Actor("Notifier");
    const { notify } = actor()
      .on("Command", "notify")

      .input({ message: "string" })

      .run(function () {
        return `real: ${this.input.message}`;
      });

    const { greet } = Action("greet")
      .use(notify)

      .input({ name: "string" })

      .run(async function () {
        return {
          aborted: this.abortSignal === controller.signal,
          message: await this.actions.notifier.notify({
            message: this.input.name,
          }),
        };
      });

    // @ts-expect-error ctx() only accepts execution context, not handler input
    greet.ctx({ input: { name: "Ada" } });

    expect(
      await greet
        .ctx({
          abortSignal: controller.signal,
          actions: {
            notifier: {
              notify: async ({ message }) => `mock: ${message}`,
            },
          },
        })
        .run({ name: "Ada" }),
    ).toEqual({
      aborted: true,
      message: "mock: Ada",
    });
  });

  test("ctx accepts bare action overrides from use()", async () => {
    const { someAction } = Action("someAction")
      .input({ value: "string" })

      .run(function () {
        return `real: ${this.input.value}`;
      });

    const { caller } = Action("caller")
      .use(someAction)

      .input({ value: "string" })

      .run(function () {
        return this.actions.someAction({ value: this.input.value });
      });

    const someActionMock = mock(async ({ value }: { value: string }) => {
      return `mock: ${value}`;
    });

    expect(
      await caller
        .ctx({
          actions: {
            someAction: someActionMock,
          },
        })
        .run({ value: "Ada" }),
    ).toEqual("mock: Ada");
    expect(someActionMock).toHaveBeenCalledWith({ value: "Ada" });
  });

  test("generic function signature — this.input is args tuple", async () => {
    const { genericAction } = Action("genericAction")
      .sig<<const T>(lorem: T) => Promise<T>>()

      .run(async function () {
        const [lorem] = this.input;

        return lorem;
      });

    type T = typeof genericAction;

    type check = Expect<
      Equal<
        TW.Action<"genericAction", <const T>(lorem: T) => Promise<T>, null>,
        T
      >
    >;

    expect(await genericAction("gpt")).toEqual("gpt");
  });

  test("HKT handler", async () => {
    interface MyHandler extends TW.Handler {
      run<const T extends this["ctx"]["model"]>(lorem: T): Promise<number>;
    }

    const { myHandler } = Action("myHandler")
      .sig<MyHandler>()

      .run(async function () {
        const [lorem] = this.input;
        return lorem.length;
      });

    type T = typeof myHandler;

    type check = Expect<
      Equal<
        TW.Action<
          "myHandler",
          <const T extends "gpt5">(lorem: T) => Promise<number>,
          Record<"handler", MyHandler>
        >,
        T
      >
    >;

    expect(await myHandler("gpt5")).toEqual(4);
  });

  test("mixed handlers — steps and async generator yield in order", async () => {
    const { mixed } = Action("mixed")
      .input({ name: "string" })

      .run(
        Step("first", function () {
          return 42;
        }),

        Step("stream", async function* () {
          yield "x";
          yield "y";

          return "Y";
        }),

        Step("third", function () {
          return true;
        }),
      );

    const yields: unknown[] = [];
    for await (const v of mixed.stream({ name: "World" })) {
      yields.push(v);
    }
    expect(eventDataList(yields)).toEqual([
      { ">>": "mixed", input: { name: "World" } },
      { ">>": "mixed.first", result: 42 },
      "x",
      "y",
      { ">>": "mixed.stream", result: "Y" },
      { ">>": "mixed.third", result: true },
      { ">>": "mixed", result: true },
    ]);
    expect(await mixed({ name: "World" })).toEqual(true);
  });

  test("Trace yielded from step is ignored", async () => {
    const { traced } = Action("traced")
      .input({ name: "string" })

      .run(
        Step("first", async function* () {
          yield new Trace("user.step", { message: "ignored" });
          yield "visible-step";

          return 1;
        }),

        Step("second", function () {
          return 2;
        }),
      );

    const yields: unknown[] = [];
    for await (const v of traced.stream({ name: "World" })) {
      yields.push(v);
    }

    expect(eventDataList(yields)).toEqual([
      { ">>": "traced", input: { name: "World" } },
      "visible-step",
      { ">>": "traced.first", result: 1 },
      { ">>": "traced.second", result: 2 },
      { ">>": "traced", result: 2 },
    ]);
    expect(await traced({ name: "World" })).toEqual(2);
  });

  test("Trace yielded from action function is ignored", async () => {
    const { traced } = Action("traced")
      .input({ name: "string" })

      .run(async function* () {
        yield new Trace("user.function", { message: "ignored" });
        yield "visible-function";

        return 2;
      });

    const yields: unknown[] = [];
    for await (const v of traced.stream({ name: "World" })) {
      yields.push(v);
    }

    expect(eventDataList(yields)).toEqual([
      { ">>": "traced", input: { name: "World" } },
      "visible-function",
      { ">>": "traced", result: 2 },
    ]);
    expect(await traced({ name: "World" })).toEqual(2);
  });

  test("Action.run disallows raw function after Step", () => {
    expect(() =>
      Action("mixed")
        .input({ name: "string" })

        .run(
          Step("first", function () {
            return 1;
          }),

          // @ts-ignore intentional invalid run shape covered by runtime guard
          async function* () {
            yield "raw";
            return 2;
          },
        ),
    ).toThrow(
      "Action.run cannot mix Step(...) handlers with raw function handlers",
    );
  });

  test("Step delegates returned async generators and promised async generators", async () => {
    async function* numberStream(value: number) {
      yield `value:${value}`;
      return value * 2;
    }

    const { run } = Action("run")
      .input({ value: "number" })

      .run(
        Step("direct", function () {
          return numberStream(this.input.value);
        }),

        Step("afterDirect", function () {
          type Check = Expect<Equal<typeof this.direct, number>>;
          return this.direct + 1;
        }),

        Step("promised", async function () {
          return numberStream(this.afterDirect);
        }),

        Step("afterPromised", function () {
          type Check = Expect<Equal<typeof this.promised, number>>;
          return this.promised + 1;
        }),
      );

    expect(await run({ value: 3 })).toEqual(15);

    const yields: unknown[] = [];
    for await (const value of run.stream({ value: 3 })) {
      yields.push(value);
    }

    expect(eventDataList(yields)).toEqual([
      { ">>": "run", input: { value: 3 } },
      "value:3",
      { ">>": "run.direct", result: 6 },
      { ">>": "run.afterDirect", result: 7 },
      "value:7",
      { ">>": "run.promised", result: 14 },
      { ">>": "run.afterPromised", result: 15 },
      { ">>": "run", result: 15 },
    ]);
  });

  test("Step pipe receives previous async generator without eagerly yielding it", async () => {
    const { count } = Action("count")
      .input({ total: "number" })

      .run(
        Step("count", async function* () {
          for (let count = 1; count <= this.input.total; count++) {
            yield count;
          }
        }),

        Step(["|>", "double"], async function* (source) {
          for await (const chunk of source) {
            yield chunk * 2;
          }
        }),
      );

    const yields: unknown[] = [];
    for await (const value of count.stream({ total: 3 })) {
      yields.push(value);
    }

    expect(eventDataList(yields)).toEqual([
      { ">>": "count", input: { total: 3 } },
      2,
      4,
      6,
      { ">>": "count.double", result: undefined },
      { ">>": "count", result: undefined },
    ]);
    expect(await count({ total: 3 })).toBeUndefined();
  });

  test("type — RawEntry keeps async generator yields", () => {
    type Ctx = {
      name: "typed";
      step: { name: string; map: {} };
      steps: [];
      scope: {};
      plugins: [];
    };

    const handler = async function* () {
      yield "chunk" as const;
      return 1 as const;
    };

    const streamed = Step<Ctx, "streamed", typeof handler, never, "streamed">(
      "streamed",
      handler,
    );

    type Output = ReturnType<(typeof streamed)[typeof TW.Step]>;
    type Entry = Output["scope"]["streamed"];

    type check = Expect<Equal<Entry, RawEntry<1, [], "chunk">>>;
  });

  test("type — user scope strips TW.Branch marker", () => {
    const { branchValue } = Action("branchValue").run(
      Step("started", function () {
        return "thread-1" as TW.Branch<{ input: void }, string, "thread-1">;
      }),

      Step("usesStarted", function () {
        type Started = typeof this.started;
        type check = Expect<Equal<Started, "thread-1">>;

        // @ts-expect-error TW.Branch is internal and should not be on user scope.
        this.started[TW.Branch];

        return this.started;
      }),
    );

    type T = typeof branchValue;
    type check = Expect<
      Equal<TW.Action<"branchValue", () => Promise<"thread-1">, null>, T>
    >;
  });

  test("step error — yields step error, action error, then rethrows", async () => {
    const boom = new Error("boom");

    const { failing } = Action("failing")
      .input({ name: "string" })

      .run(
        Step("first", function () {
          return 1;
        }),

        Step("bad", function () {
          throw boom;
        }),

        Step("never", function () {
          return 3;
        }),
      );

    const yields: unknown[] = [];
    let thrown: unknown;

    try {
      for await (const v of failing.stream({ name: "World" })) {
        yields.push(v);
      }
    } catch (e) {
      thrown = e;
    }

    expect(eventDataList(yields)).toEqual([
      { ">>": "failing", input: { name: "World" } },
      { ">>": "failing.first", result: 1 },
      { ">>": "failing.bad", error: boom },
      { ">>": "failing", error: boom },
    ]);
    expect(thrown).toBe(boom);
  });

  test("Logger — logs each event via provided function", async () => {
    const logged: unknown[] = [];
    const spy = {
      log: logged.push.bind(logged),
      info: logged.push.bind(logged),
      error: logged.push.bind(logged),
    };

    const { healthz } = Action("healthz")
      .use(Logger(spy))

      .run(function () {
        return { status: "ok" };
      });

    await healthz();

    expect(logged).toEqual([
      formatEvent({ ">>": "healthz", input: undefined }),
      formatEvent({ ">>": "healthz", result: { status: "ok" } }),
    ]);
  });

  test("Logger — formats cyclic objects without recursing forever", async () => {
    const cyclic: Record<string, unknown> = { name: "cycle" };
    cyclic.self = cyclic;

    expect(formatEvent({ ">>": "cyclic", result: cyclic })).toBe(
      '\x1b[2m{\x1b[22m \x1b[2m">>": \x1b[22m"\x1b[1mcyclic\x1b[22m", \x1b[2m"result": \x1b[22m{ "name": "cycle", "self": "[Circular]" } \x1b[2m}\x1b[22m',
    );
  });

  test("Logger — uses custom toJSON representations", async () => {
    const page = {
      url: "https://example.com",
      toJSON() {
        return "page";
      },
    };

    expect(formatEvent({ ">>": "page", result: page })).toBe(
      '\x1b[2m{\x1b[22m \x1b[2m">>": \x1b[22m"\x1b[1mpage\x1b[22m", \x1b[2m"result": \x1b[22m"page" \x1b[2m}\x1b[22m',
    );
  });

  test("Logger — limits nested object depth", async () => {
    const nested = { a: { b: { c: { d: "hidden" } } } };

    expect(formatEvent({ ">>": "nested", result: nested })).toBe(
      '\x1b[2m{\x1b[22m \x1b[2m">>": \x1b[22m"\x1b[1mnested\x1b[22m", \x1b[2m"result": \x1b[22m{ "a": { "b": { "c": "[Object]" } } } \x1b[2m}\x1b[22m',
    );
  });

  test("Logger — stream also logs", async () => {
    const logged: unknown[] = [];
    const spy = {
      log: logged.push.bind(logged),
      info: logged.push.bind(logged),
      error: logged.push.bind(logged),
    };

    const { hello } = Action("hello")
      .use(Logger(spy))

      .input({ name: "string" })

      .run(function () {
        return `Hello ${this.input.name}`;
      });

    const yields: unknown[] = [];

    for await (const v of hello.stream({ name: "World" })) {
      yields.push(v);
    }

    expect(logged).toEqual(
      eventDataList(yields).flatMap((v) => {
        if (
          typeof v !== "object" ||
          v === null ||
          !(">>" in (v as object) || "==" in (v as object))
        )
          return [v];
        const e = v as Record<string, unknown>;
        const out = formatEvent(e);
        const items: unknown[] = [];
        items.push(out);
        return items;
      }),
    );
  });

  test("Logger — logs Step events", async () => {
    const logged: unknown[] = [];
    const spy = {
      log: logged.push.bind(logged),
      info: logged.push.bind(logged),
      error: logged.push.bind(logged),
    };

    const { compute } = Action("compute")
      .use(Logger(spy))

      .input({ value: "number" })

      .run(
        Step("double", function () {
          return this.input.value * 2;
        }),

        Step("positive", function () {
          return this.double > 0;
        }),
      );

    await compute({ value: 3 });

    expect(logged).toEqual([
      formatEvent({ ">>": "compute", input: { value: 3 } }),
      formatEvent({ ">>": "compute.double", result: 6 }),
      formatEvent({ ">>": "compute.positive", result: true }),
      formatEvent({ ">>": "compute", result: true }),
    ]);
  });

  test("InferType — .run() returns steps as typed tuple", () => {
    const { compute } = Action("compute")
      .use(InferType())

      .input({ name: "string", thread: { sender: { name: "string" } } })

      .run(
        Step("gent", function () {
          return this.actions.generateText({
            model: "gpt5",
            prompt: `hello ${this.input.thread.sender.name}`,
          });
        }),

        Step("reply", function () {
          return this.actions.generateText({
            model: "gpt5",
            prompt: `reply to ${this.gent} from ${this.input.thread.sender.name}`,
          });
        }),

        Step("positive", function () {
          return this.gent.length > 2;
        }),

        Step("done", function () {
          return this.reply === this.input.name;
        }),
      );

    type T = typeof compute;

    type check = Expect<
      Equal<
        T,
        {
          "->": "Command";
          "=": "compute";
          run: [
            TW.ActionStep<
              "gent",
              "generateText",
              { model: "gpt5"; prompt: string }
            >,
            TW.ActionStep<
              "reply",
              "generateText",
              { model: "gpt5"; prompt: string }
            >,
            TW.ScriptStep<"positive", () => boolean>,
            TW.ScriptStep<"done", () => boolean>,
          ];
        }
      >
    >;

    expect(compute).toEqual({
      "->": "Command",
      "=": "compute",
      run: [
        {
          $: "generateText",
          "=": "gent",
          model: "gpt5",
          prompt: "hello @{input.thread.sender.name}",
        },
        {
          $: "generateText",
          "=": "reply",
          model: "gpt5",
          prompt: "reply to @{gent} from @{input.thread.sender.name}",
        },
        {
          $: "step",
          "=": "positive",
          run: "@{function() {\nreturn this.gent.length > 2;\n}}",
        },
        {
          $: "step",
          "=": "done",
          run: "@{function() {\nreturn this.reply === this.input.name;\n}}",
        },
      ],
    });
  });

  test("InferType — .run() returns steps as typed tuple", () => {
    const { compute } = Action("compute")
      .use(InferType("positive"))

      .input({ name: "string", thread: { sender: { name: "string" } } })

      .run(
        Step("gent", function () {
          return this.actions.generateText({
            model: "gpt5",
            prompt: `hello ${this.input.thread.sender.name}`,
          });
        }),

        Step("reply", function () {
          return this.actions.generateText({
            model: "gpt5",
            prompt: `reply to ${this.gent} from ${this.input.name}`,
          });
        }),

        Step("positive", function () {
          return this.gent.length > 2;
        }),

        Step("done", function () {
          return this.reply === this.input.name;
        }),
      );

    type InferScope<A> = A extends TW.ScriptStep<any, infer H>
      ? H extends (this: infer U, ...args: any[]) => any
        ? U
        : never
      : never;

    type ExactOmit<T, K extends keyof T> = {
      [P in keyof T as P extends K ? never : P]: T[P];
    };

    type T = ExactOmit<
      InferScope<typeof compute>,
      "thread" | "actions" | "abortSignal" | "self" | "signal" | "event"
    >;

    type check = Expect<
      Equal<
        T,
        {
          reply: string;
          gent: string;
          input: {
            name: string;
            thread: {
              sender: {
                name: string;
              };
            };
          };
        }
      >
    >;

    // cast needed because the declared type narrows non-matching positions to
    // `undefined`, while the runtime value still carries the full step objects
    expect(compute).toEqual({
      $: "step",
      "=": "positive",
      run: "@{function() {\nreturn this.gent.length > 2;\n}}",
    });
  });

  test("use(TW.Action) — bare Action (no Actor) injected directly as this.actions.<name>", async () => {
    // Bare Action — no Actor wrapper; flat name → this.actions.notify run
    const { notify } = Action("notify")
      .input({ message: "string" })

      .run(function () {
        return `sent: ${this.input.message}`;
      });

    const { greet } = Action("greet")
      .use(notify)

      .input({ name: "string" })

      .run(
        Step("notify", function () {
          // flat name → this.actions.notify is the action run function
          type Check = Expect<
            Equal<typeof this.actions.notify, typeof notify.run>
          >;
          return this.actions.notify({ message: this.input.name });
        }),

        Step("message", function () {
          return `Hello, ${this.notify}`;
        }),
      );

    expect(await greet({ name: "World" })).toEqual("Hello, sent: World");
  });

  test("use(TW.Action) — Actor-service action injected into this.actions.<service>.<method>", async () => {
    // Actor-created: TW.Name = "Notifier::notify" → this.actions.notifier.notify
    const { actor } = Actor("Notifier");

    const { notify } = actor()
      .on("Command", "notify")

      .input({ message: "string" })

      .run(function () {
        return `sent: ${this.input.message}`;
      });

    const { greet } = Action("greet")
      .use(notify)

      .input({ name: "string" })

      .run(
        Step("notify", function () {
          type Check = Expect<
            Equal<typeof this.actions.notifier.notify, typeof notify.run>
          >;
          return this.actions.notifier.notify({
            message: this.input.name,
          });
        }),

        Step("message", function () {
          return `Hello, ${this.notify}`;
        }),
      );

    expect(await greet({ name: "World" })).toEqual("Hello, sent: World");
  });

  test("use(object) — injects TW.Actions and ignores non-action exports", async () => {
    const { notify } = Action("notify")
      .input({ message: "string" })

      .run(function () {
        return `sent: ${this.input.message}`;
      });

    const { greet } = Action("greet")
      .use(
        Promise.resolve({
          notify,
          helper: () => "ignored",
          version: "1.0.0",
        }),
      )

      .input({ name: "string" })

      .run(
        Step("notify", function () {
          type Check = Expect<
            Equal<typeof this.actions.notify, typeof notify.run>
          >;
          type HelperIsIgnored = "helper" extends keyof typeof this.actions
            ? false
            : true;
          type HelperCheck = Expect<Equal<HelperIsIgnored, true>>;

          return this.actions.notify({ message: this.input.name });
        }),
      );

    expect(await greet({ name: "World" })).toEqual("sent: World");
  });

  test("meta options can use an injected conversationsList action for Slack.postMessage", async () => {
    const channels = [
      { id: "C123", name: "general" },
      { id: "C456", name: "engineering" },
    ];

    const { conversationsList } = Action("conversationsList")
      .input({ types: "string" })

      .run(function () {
        return {
          ok: true,
          channels:
            this.input.types === "public_channel"
              ? channels
              : channels.slice(1),
        };
      });

    const { channelIds } = Action("channelIds")
      .input({ types: "string" })

      .run(function () {
        return {
          channels: channels.map((channel) => channel.id),
          parent: {
            nested: channels.map((channel) => channel.id),
          },
        };
      });

    const { numericChannelsList } = Action("numericChannelsList")
      .input({ types: "string" })

      .run(function () {
        return {
          ok: true,
          channels: [
            { id: 123, name: "general" },
            { id: 456, name: "engineering" },
          ],
        };
      });

    Action("pathSuggestions")
      .use(channelIds)

      .input({ channel: "string", nested: "string" })

      .run(function () {
        return { ok: true };
      })

      .meta({
        input: {
          channel: {
            suggestions: {
              $: "channelIds",
              "*": ($) =>
                $.channels.map((value) => ({ value, label: value })),
              types: "public_channel",
            },
          },
          nested: {
            suggestions: {
              $: "channelIds",
              "*": ($) =>
                $.parent.nested.map((value) => ({ value, label: value })),
              types: "public_channel",
            },
          },
        },
      });

    Action("numericChannelSuggestions")
      .use(numericChannelsList)

      .input({ channel: "number" })

      .run(function () {
        return { ok: true };
      })

      .meta({
        input: {
          channel: {
            suggestions: {
              $: "numericChannelsList",
              "*": (result) =>
                result.channels.map((x) => ({ value: x.id, label: x.name })),
              types: "public_channel",
            },
          },
        },
      });

    const { postMessage } = Action("postMessage")
      .use(conversationsList)

      .input({ channel: "string", text: "string" })

      .run(
        Step("channels", function () {
          return this.actions.conversationsList({
            types: "public_channel",
          });
        }),

        Step("message", function () {
          const selected = this.channels.channels.find(
            (item) => item.id === this.input.channel,
          );

          return {
            channel: selected,
            text: this.input.text,
          };
        }),
      )

      .meta({
        description: "Post a message to a Slack channel",
        input: {
          channel: {
            description: "Channel receiving the message",
            example: "#general",
            suggestions: {
              $: "conversationsList",
              "*": (result) =>
                result.channels.map((x) => ({ value: x.id, label: x.name })),
              types: "public_channel",
            },
          },
          text: {
            description: "Message text",
            example: "Deploy completed",
          },
        },
        output: {
          channel: "The selected channel",
          text: "The posted message",
        },
      });

    Action("invalidMeta")
      .input({ channel: "string", text: "string" })

      .run(function () {
        return { ok: true };
      })

      .meta({
        input: {
          // @ts-expect-error metadata input keys must exist in the action scope input
          missing: "Not an action input",
        },
      });

    Action("invalidOutputMeta")
      .input({ channel: "string" })

      .run(function () {
        return { ok: true };
      })

      .meta({
        output: {
          // @ts-expect-error metadata output keys must exist in the action result
          missing: "Not an action output",
        },
      });

    Action("invalidSuggestionField")
      .use(conversationsList)

      .input({ channel: "string" })

      .run(function () {
        return { ok: true };
      })

      .meta({
        input: {
          channel: {
            suggestions: {
              $: "conversationsList",
              "*": ($) =>
                // @ts-expect-error suggestion maps must provide string/number values
                $.channels.map<{ value: boolean; label: string }>((x) => ({
                  // @ts-expect-error suggestion maps must provide string/number values
                  value: x.id,
                  label: x.name,
                })),
              types: "public_channel",
            },
          },
        },
      });

    Action("invalidLegacySuggestionPath")
      .use(conversationsList)

      .input({ channel: "string" })

      .run(function () {
        return { ok: true };
      })

      .meta({
        input: {
          channel: {
            suggestions: {
              $: "conversationsList",
              // @ts-expect-error suggestion paths use dot-path syntax and mapped fields use arrays
              "*": [".channels[]", [".name", ".id"]],
              types: "public_channel",
            },
          },
        },
      });

    Action("invalidTypedSuggestionPath")
      .use(conversationsList)

      .input({ channel: "string" })

      .run(function () {
        return { ok: true };
      })

      .meta({
        input: {
          channel: {
            suggestions: {
              $: "conversationsList",
              // @ts-expect-error selector paths must exist on the referenced action output
              "*": ($) => $.missing,
              types: "public_channel",
            },
          },
        },
      });

    Action("unconstrainedSuggestionValue")
      .use(conversationsList)

      .input({ channel: "number" })

      .run(function () {
        return { ok: true };
      })

      .meta({
        input: {
          channel: {
            suggestions: {
              $: "conversationsList",
              "*": ($) =>
                $.channels.map((x) => ({ value: x.id, label: x.name })),
              types: "public_channel",
            },
          },
        },
      });

    const meta = postMessage[TW.Meta];
    expect(meta.description).toEqual("Post a message to a Slack channel");
    expect(meta.input.channel.suggestions.$).toBe("conversationsList");
    const selector = meta.input.channel.suggestions["*"] as unknown as {
      [ToCEL](): string;
    };
    expect(selector[ToCEL]()).toBe(
      'result.channels.map(x, {"value": x.id, "label": x.name})',
    );
    expect(meta.input.channel.suggestions.types).toBe("public_channel");
    expect(meta.output.channel).toEqual("The selected channel");
    expect(
      await postMessage({ channel: "C456", text: "Deploy completed" }),
    ).toEqual({
      channel: { id: "C456", name: "engineering" },
      text: "Deploy completed",
    });
  });

  test("async generator — stream yields each value", async () => {
    const { greet } = Action("greet")
      .input({ name: "string" })

      .run(async function* () {
        yield this.input.name;
        yield this.input.name.toUpperCase();
      });

    type check = Expect<
      typeof greet extends TW.Action<
        "greet",
        (input: { name: string }) => Promise<void>,
        null
      >
        ? true
        : false
    >;

    const values: unknown[] = [];
    for await (const v of greet.stream({ name: "hello" })) {
      values.push(v);
    }
    expect(eventDataList(values)).toEqual([
      { ">>": "greet", input: { name: "hello" } },
      "hello",
      "HELLO",
      { ">>": "greet", result: undefined },
    ]);
  });

  test("stream completion returns the action result", async () => {
    const { compute } = Action("compute")
      .input({ value: "number" })

      .run(
        Step("double", function () {
          return this.input.value * 2;
        }),
      );

    const stream = compute.stream({ value: 4 });
    let item = await stream.next();
    while (!item.done) item = await stream.next();

    expect(item.value).toBe(8);
  });

  test("action observers publish events while an awaited promise is running", async () => {
    let publish: ((event: unknown) => void) | undefined;
    let finish: ((value: string) => void) | undefined;
    let disposed = false;
    const observer = {
      [TW.ActionObserver](_actionName: string, emit: (event: unknown) => void) {
        publish = emit;
        return Object.assign(() => [], {
          dispose() {
            disposed = true;
          },
        });
      },
    };
    const { waitForAgent } = Action("waitForAgent").run(
      Step("answer", async function () {
        publish?.(new Message("ACP::AgentThoughtChunk", { text: "thinking" }));
        return await new Promise<string>((resolve) => {
          finish = resolve;
        });
      }),
    );
    const stream = waitForAgent.ctx({ observer }).stream();

    expect((await stream.next()).value).toBeInstanceOf(Trace);
    const update = await stream.next();
    expect(update.done).toBe(false);
    expect(update.value).toBeInstanceOf(Message);
    expect((update.value as Message).message).toBe("ACP::AgentThoughtChunk");

    finish?.("done");
    let next = await stream.next();
    while (!next.done) next = await stream.next();
    expect(next.value).toBe("done");
    expect(disposed).toBe(true);
  });
});
