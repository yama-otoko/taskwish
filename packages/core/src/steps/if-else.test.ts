/* oxlint-disable no-unused-vars -- Compile-time assertions intentionally have no runtime use. */

import { expect, test, describe } from "bun:test";
import { Expect, Equal } from "../helpers";
import { Action } from "../action";
import { Step } from "./step";
import { If, Else, ElseIf, Cond } from "./if-else";
import { Loop, ForEach } from "./loop";
import { messageLogData } from "@taskwish/wind";

const eventDataList = (values: unknown[]) => values.map(messageLogData);

// ─── Runtime ────────────────────────────────────────────────────────────────

describe("If / Else", () => {
  test("recursive factorial using If branches", async () => {
    const { factorial } = Action("factorial")
      .input({ n: "number" })

      .run(
        If(
          Cond(({ input }) => input.n <= 1),

          Step("done", function () {
            return 1;
          }),
        ),
        Else(
          Step("next", function () {
            return this.self({ n: this.input.n - 1 });
          }),

          Step("multiply", function () {
            return this.input.n * this.next;
          }),
        ),
      );

    type T = typeof factorial;
    type RetVal = Awaited<ReturnType<T>>;

    type check = Expect<Equal<RetVal, number>>;

    expect(await factorial({ n: 5 })).toEqual(120);

    const yields: unknown[] = [];

    for await (const v of factorial.stream({ n: 3 })) {
      yields.push(v);
    }

    expect(eventDataList(yields)).toEqual([
      { ">>": "factorial", input: { n: 3 } },
      { ">>": "factorial.next", input: { n: 2 } },
      { ">>": "factorial.next.next", input: { n: 1 } },
      { ">>": "factorial.next.next.done", result: 1 },
      { ">>": "factorial.next.next", result: 1 },
      { ">>": "factorial.next.multiply", result: 2 },
      { ">>": "factorial.next", result: 2 },
      { ">>": "factorial.multiply", result: 6 },
      { ">>": "factorial", result: 6 },
    ]);
  });

  test("runs if-branch when condition is true", async () => {
    const { branch } = Action("branch")
      .input({ flag: "boolean" })

      .run(
        If(
          Cond(({ input }) => input.flag),

          Step("result", function () {
            return "truthy" as const
          }),
        ),

        Else(
          Step("result", function () {
            return "falsy" as const
          }),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, "truthy" | "falsy">>;

    expect(await branch({ flag: true })).toEqual("truthy");

    const yields: unknown[] = [];
    for await (const v of branch.stream({ flag: true })) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { flag: true } },
      { ">>": "branch.if.result", result: "truthy" },
      { ">>": "branch", result: "truthy" },
    ]);
  });

  test("runs else-branch when condition is false", async () => {
    const { branch } = Action("branch")
      .input({ flag: "boolean" })

      .run(
        If(
          Cond(({ input }) => input.flag),

          Step("result", function () {
            return "truthy" as const
          }),
        ),

        Else(
          Step("result", function () {
            return "falsy" as const
          }),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, "truthy" | "falsy">>;

    expect(await branch({ flag: false })).toEqual("falsy");

    const yields: unknown[] = [];
    for await (const v of branch.stream({ flag: false })) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { flag: false } },
      { ">>": "branch.else.result", result: "falsy" },
      { ">>": "branch", result: "falsy" },
    ]);
  });

  test("skips branch when condition is false and no Else", async () => {
    const { branch } = Action("branch")
      .input({ run: "boolean" })

      .run(
        Step("before", function () {
          return 1;
        }),

        If(
          Cond(({ input }) => input.run),

          Step("skipped", function () {
            return 99;
          }),
        ),

        Step("after", function () {
          return this.before;
        }),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, number>>;

    expect(await branch({ run: false })).toEqual(1);

    const yields: unknown[] = [];
    for await (const v of branch.stream({ run: false })) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { run: false } },
      { ">>": "branch.before", result: 1 },
      { ">>": "branch.after", result: 1 },
      { ">>": "branch", result: 1 },
    ]);
  });

  test("inner step accesses outer scope", async () => {
    const { branch } = Action("branch")
      .input({ value: "number" })

      .run(
        Step("doubled", function () {
          return this.input.value * 2;
        }),

        If(
          Cond(({ input }) => input.value > 0),

          Step("result", function () {
            return this.doubled > 0;
          }),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, number | boolean>>;

    expect(await branch({ value: 3 })).toEqual(true);

    const yields: unknown[] = [];
    for await (const v of branch.stream({ value: 3 })) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { value: 3 } },
      { ">>": "branch.doubled", result: 6 },
      { ">>": "branch.if.result", result: true },
      { ">>": "branch", result: true },
    ]);
  });

  test("condition receives scope", async () => {
    const { branch } = Action("branch")
      .input({ x: "number" })

      .run(
        If(
          Cond(({ input }) => input.x > 10),

          Step("result", function () {
            return this.condition ? "big" : "not big";
          }),
        ),

        Else(
          Step("result", function () {
            return "small" as const
          }),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, "big" | "not big" | "small">>;

    expect(await branch({ x: 5 })).toEqual("small");
    expect(await branch({ x: 20 })).toEqual("big");

    const yields: unknown[] = [];
    for await (const v of branch.stream({ x: 20 })) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { x: 20 } },
      { ">>": "branch.if.result", result: "big" },
      { ">>": "branch", result: "big" },
    ]);
  });

  test("runs else-if step when if is false and else-if is true", async () => {
    const { branch } = Action("branch")
      .input({ x: "number" })

      .run(
        If(
          Cond(({ input }) => input.x > 10),

          Step("result", function () {
            return "big" as const
          }),
        ),

        ElseIf(
          Cond(({ input }) => input.x > 5),

          Step("result", function () {
            return "medium" as const
          }),
        ),

        Else(
          Step("result", function () {
            return "small" as const
          }),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, "big" | "medium" | "small">>;

    expect(await branch({ x: 20 })).toEqual("big");
    expect(await branch({ x: 7 })).toEqual("medium");
    expect(await branch({ x: 2 })).toEqual("small");

    const yields: unknown[] = [];
    for await (const v of branch.stream({ x: 7 })) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { x: 7 } },
      { ">>": "branch.elseIf.result", result: "medium" },
      { ">>": "branch", result: "medium" },
    ]);
  });

  test("multi-step If — inner steps thread context", async () => {
    const { branch } = Action("branch")
      .input({ x: "number" })

      .run(
        If(
          Cond(({ input }) => input.x > 0),

          Step("doubled", function () {
            return this.input.x * 2;
          }),

          Step("label", function () {
            return `val:${this.doubled}`;
          }),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, string | undefined>>;

    expect(await branch({ x: 5 })).toEqual("val:10");

    const yields: unknown[] = [];
    for await (const v of branch.stream({ x: 5 })) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { x: 5 } },
      { ">>": "branch.if.doubled", result: 10 },
      { ">>": "branch.if.label", result: "val:10" },
      { ">>": "branch", result: "val:10" },
    ]);
  });

  test("multi-step Else — inner steps thread context", async () => {
    const { branch } = Action("branch")
      .input({ x: "number" })

      .run(
        If(
          Cond(({ input }) => input.x > 10),

          Step("result", function () {
            return "if-branch";
          }),
        ),

        Else(
          Step("doubled", function () {
            return this.input.x * 2;
          }),

          Step("label", function () {
            return `val:${this.doubled}`;
          }),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, string>>;

    expect(await branch({ x: 4 })).toEqual("val:8");

    const yields: unknown[] = [];
    for await (const v of branch.stream({ x: 4 })) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { x: 4 } },
      { ">>": "branch.else.doubled", result: 8 },
      { ">>": "branch.else.label", result: "val:8" },
      { ">>": "branch", result: "val:8" },
    ]);
  });

  test("multi-step ElseIf — inner steps thread context", async () => {
    const { branch } = Action("branch")
      .input({ x: "number" })

      .run(
        If(
          Cond(({ input }) => input.x > 10),

          Step("result", function () {
            return "big";
          }),
        ),

        ElseIf(
          Cond(({ input }) => input.x > 0),

          Step("doubled", function () {
            return this.input.x * 2;
          }),

          Step("label", function () {
            return `medium:${this.doubled}`;
          }),
        ),

        Else(
          Step("result", function () {
            return "negative";
          }),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, string>>;

    expect(await branch({ x: 5 })).toEqual("medium:10");
    expect(await branch({ x: 20 })).toEqual("big");
    expect(await branch({ x: -1 })).toEqual("negative");

    const yields: unknown[] = [];
    for await (const v of branch.stream({ x: 5 })) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { x: 5 } },
      { ">>": "branch.elseIf.doubled", result: 10 },
      { ">>": "branch.elseIf.label", result: "medium:10" },
      { ">>": "branch", result: "medium:10" },
    ]);
  });

  // ─── Type tests ─────────────────────────────────────────────────────────

  test("type — after If, added scope key is optional", () => {
    const { branch } = Action("branch")
      .input({ run: "boolean" })

      .run(
        If(
          Cond(({ input }) => input.run),

          Step("check", function () {
            return 42 as number;
          }),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;

    type check = Expect<Equal<RetVal, number | undefined>>;
  });

  test("type — after If + Else same key, return is required union", () => {
    const { branch } = Action("branch")
      .input({ flag: "boolean" })

      .run(
        If(
          Cond(({ input }) => input.flag),

          Step("check", function () {
            return "yes" as const;
          }),
        ),

        Else(
          Step("check", function () {
            return "no" as const;
          }),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;

    type check = Expect<Equal<RetVal, "yes" | "no">>;
  });

  test("type — If + ElseIf + Else produces required three-way union", () => {
    const { branch } = Action("branch")
      .input({ x: "number" })

      .run(
        If(
          Cond(({ input }) => input.x > 10),

          Step("result", function () {
            return "a" as const;
          }),
        ),

        ElseIf(
          Cond(({ input }) => input.x > 5),

          Step("result", function () {
            return "b" as const;
          }),
        ),

        Else(
          Step("result", function () {
            return "c" as const;
          }),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;

    type check = Expect<Equal<RetVal, "a" | "b" | "c">>;
  });

  test("type — If + ElseIf without Else is optional union", () => {
    const { branch } = Action("branch")
      .input({ x: "number" })

      .run(
        If(
          Cond(({ input }) => input.x > 10),

          Step("result", function () {
            return "a" as const;
          }),
        ),

        ElseIf(
          Cond(({ input }) => input.x > 5),

          Step("result", function () {
            return "b" as const;
          }),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;

    type check = Expect<Equal<RetVal, "a" | "b" | undefined>>;
  });

  test("type — multi-step If threads context to last step", () => {
    Action("branch")
      .input({ x: "number" })

      .run(
        If(
          Cond(({ input }) => input.x > 0),

          Step("doubled", function () {
            return this.input.x * 2;
          }),

          Step("label", function () {
            type check = Expect<Equal<typeof this.doubled, number>>;
            return `${this.doubled}`;
          }),
        ),
      );
  });

  test("type — multi-step ElseIf threads context to last step", () => {
    Action("branch")
      .input({ x: "number" })

      .run(
        If(
          Cond(({ input }) => input.x > 10),

          Step("result", function () {
            return 0 as number;
          }),
        ),

        ElseIf(
          Cond(({ input }) => input.x > 0),

          Step("doubled", function () {
            return this.input.x * 2;
          }),

          Step("label", function () {
            type check = Expect<Equal<typeof this.doubled, number>>;
            return `${this.doubled}`;
          }),
        ),
      );
  });

  test("type — multi-step Else threads context to last step", () => {
    Action("branch")
      .input({ x: "number" })

      .run(
        If(
          Cond(({ input }) => input.x > 0),

          Step("result", function () {
            return 0 as number;
          }),
        ),

        Else(
          Step("doubled", function () {
            return this.input.x * 2;
          }),

          Step("label", function () {
            type check = Expect<Equal<typeof this.doubled, number>>;
            return `${this.doubled}`;
          }),
        ),
      );
  });

  // ─── Loop inside If ──────────────────────────────────────────────────────

  test("Loop inside If runs when condition is true", async () => {
    const { branch } = Action("branch")
      .input({ run: "boolean" })

      .run(
        If(
          Cond(({ input }) => input.run),

          Loop(
            ForEach(() => [1, 2, 3]),

            Step("val", function () {
              return this.loop.item * 2;
            }),
          ),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, number[] | undefined>>;

    expect(await branch({ run: true })).toEqual([2, 4, 6]);

    const yields: unknown[] = [];
    for await (const v of branch.stream({ run: true })) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { run: true } },
      { ">>": "branch.if.loop", items: [1, 2, 3] },
      { ">>": "branch.if.loop[0].val", result: 2 },
      { ">>": "branch.if.loop[1].val", result: 4 },
      { ">>": "branch.if.loop[2].val", result: 6 },
      { ">>": "branch", result: [2, 4, 6] },
    ]);
  });

  test("Loop inside If skipped when condition is false", async () => {
    const { branch } = Action("branch")
      .input({ run: "boolean" })

      .run(
        Step("before", function () {
          return 99;
        }),

        If(
          Cond(({ input }) => input.run),

          Loop(
            ForEach(() => [1, 2, 3]),

            Step("val", function () {
              return this.loop.item;
            }),
          ),
        ),

        Step("after", function () {
          return this.before;
        }),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, number>>;

    expect(await branch({ run: false })).toEqual(99);

    const yields: unknown[] = [];
    for await (const v of branch.stream({ run: false })) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { run: false } },
      { ">>": "branch.before", result: 99 },
      { ">>": "branch.after", result: 99 },
      { ">>": "branch", result: 99 },
    ]);
  });

  test("Loop inside Else runs when condition is false", async () => {
    const { branch } = Action("branch")
      .input({ run: "boolean" })

      .run(
        If(
          Cond(({ input }) => input.run),

          Step("result", function () {
            return "if-branch";
          }),
        ),

        Else(
          Loop(
            ForEach(() => [10, 20]),

            Step("result", function () {
              return this.loop.item;
            }),
          ),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, string | number[]>>;

    expect(await branch({ run: false })).toEqual([10, 20]);

    const yields: unknown[] = [];
    for await (const v of branch.stream({ run: false })) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { run: false } },
      { ">>": "branch.else.loop", items: [10, 20] },
      { ">>": "branch.else.loop[0].result", result: 10 },
      { ">>": "branch.else.loop[1].result", result: 20 },
      { ">>": "branch", result: [10, 20] },
    ]);
  });

  test("Loop accumulated result available after If", async () => {
    const { branch } = Action("branch")
      .input({ run: "boolean" })

      .run(
        If(
          Cond(({ input }) => input.run),

          Loop(
            ForEach(() => [1, 2, 3]),

            Step("doubled", function () {
              return this.loop.item * 2;
            }),
          ),
        ),

        Step("sum", function () {
          return (this.doubled as number[]).reduce((a, b) => a + b, 0);
        }),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, number>>;

    expect(await branch({ run: true })).toEqual(12);

    const yields: unknown[] = [];
    for await (const v of branch.stream({ run: true })) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { run: true } },
      { ">>": "branch.if.loop", items: [1, 2, 3] },
      { ">>": "branch.if.loop[0].doubled", result: 2 },
      { ">>": "branch.if.loop[1].doubled", result: 4 },
      { ">>": "branch.if.loop[2].doubled", result: 6 },
      { ">>": "branch.sum", result: 12 },
      { ">>": "branch", result: 12 },
    ]);
  });

  // ─── If inside If ────────────────────────────────────────────────────────

  test("If inside If — both true runs inner step", async () => {
    const { branch } = Action("branch")
      .input({ outer: "boolean", inner: "boolean" })

      .run(
        If(
          Cond(({ input }) => input.outer),

          If(
            Cond(({ input }) => input.inner),

            Step("result", function () {
              return "both";
            }),
          ),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, string | undefined>>;

    expect(await branch({ outer: true, inner: true })).toEqual("both");

    const yields: unknown[] = [];
    for await (const v of branch.stream({ outer: true, inner: true }))
      yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { outer: true, inner: true } },
      { ">>": "branch.if.if.result", result: "both" },
      { ">>": "branch", result: "both" },
    ]);
  });

  test("If inside If — inner false skips inner step", async () => {
    const { branch } = Action("branch")
      .input({ outer: "boolean", inner: "boolean" })

      .run(
        Step("before", function () {
          return 1;
        }),

        If(
          Cond(({ input }) => input.outer),

          If(
            Cond(({ input }) => input.inner),

            Step("result", function () {
              return "inner";
            }),
          ),
        ),

        Step("after", function () {
          return this.before;
        }),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, number>>;

    expect(await branch({ outer: true, inner: false })).toEqual(1);

    const yields: unknown[] = [];
    for await (const v of branch.stream({ outer: true, inner: false }))
      yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { outer: true, inner: false } },
      { ">>": "branch.before", result: 1 },
      { ">>": "branch.after", result: 1 },
      { ">>": "branch", result: 1 },
    ]);
  });

  test("If inside If — outer false skips both", async () => {
    const { branch } = Action("branch")
      .input({ outer: "boolean", inner: "boolean" })

      .run(
        Step("before", function () {
          return 42;
        }),

        If(
          Cond(({ input }) => input.outer),

          If(
            Cond(({ input }) => input.inner),

            Step("result", function () {
              return "inner";
            }),
          ),
        ),

        Step("after", function () {
          return this.before;
        }),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, number>>;

    expect(await branch({ outer: false, inner: true })).toEqual(42);

    const yields: unknown[] = [];
    for await (const v of branch.stream({ outer: false, inner: true }))
      yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { outer: false, inner: true } },
      { ">>": "branch.before", result: 42 },
      { ">>": "branch.after", result: 42 },
      { ">>": "branch", result: 42 },
    ]);
  });

  test("If inside If — condition receives scope at both levels", async () => {
    const { branch } = Action("branch")
      .input({ x: "number" })

      .run(
        If(
          Cond(({ input }) => input.x > 0),

          If(
            Cond(({ input }) => input.x > 10),

            Step("result", function () {
              return "big" as const
            }),
          ),
          Else(
            Step("result", function () {
              return "small" as const
            }),
          ),
        ),

        Else(
          Step("result", function () {
            return "negative" as const
          }),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, "big" | "small" | "negative">>;

    expect(await branch({ x: -1 })).toEqual("negative");
    expect(await branch({ x: 5 })).toEqual("small");
    expect(await branch({ x: 20 })).toEqual("big");

    const yields: unknown[] = [];
    for await (const v of branch.stream({ x: 20 })) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { x: 20 } },
      { ">>": "branch.if.if.result", result: "big" },
      { ">>": "branch", result: "big" },
    ]);
  });
});
