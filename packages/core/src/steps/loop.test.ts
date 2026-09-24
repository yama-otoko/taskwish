/* oxlint-disable no-unused-vars -- Compile-time assertions intentionally have no runtime use. */

import { expect, test, describe } from "bun:test";
import { Expect, Equal } from "../helpers";
import { Action } from "../action";
import { Step } from "./step";
import { Loop, ForEach } from "./loop";
import { If, Else, ElseIf, Cond } from "./if-else";
import { messageLogData } from "@taskwish/wind";

const eventDataList = (values: unknown[]) => values.map(messageLogData);

// ─── Runtime ────────────────────────────────────────────────────────────────

describe("Loop", () => {
  test("array literal as items", async () => {
    const { branch } = Action("branch").run(
      Loop(
        ForEach([1, 2, 3]),

        Step("doubled", function () {
          return this.loop.item * 2;
        }),
      ),
    );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, number[]>>;

    expect(await branch()).toEqual([2, 4, 6]);

    const yields: unknown[] = [];
    for await (const v of branch.stream()) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch" },
      { ">>": "branch.loop", items: [1, 2, 3] },
      { ">>": "branch.loop[0].doubled", result: 2 },
      { ">>": "branch.loop[1].doubled", result: 4 },
      { ">>": "branch.loop[2].doubled", result: 6 },
      { ">>": "branch", result: [2, 4, 6] },
    ]);
  });

  test("maps over input array", async () => {
    const { branch } = Action("branch")
      .input({ nums: "number[]" })

      .run(
        Loop(
          ForEach(({ input }) => input.nums),

          Step("doubled", function () {
            return this.loop.item * 2;
          }),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, number[]>>;

    expect(await branch({ nums: [1, 2, 3] })).toEqual([2, 4, 6]);

    const yields: unknown[] = [];
    for await (const v of branch.stream({ nums: [1, 2, 3] })) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { nums: [1, 2, 3] } },
      { ">>": "branch.loop", items: [1, 2, 3] },
      { ">>": "branch.loop[0].doubled", result: 2 },
      { ">>": "branch.loop[1].doubled", result: 4 },
      { ">>": "branch.loop[2].doubled", result: 6 },
      { ">>": "branch", result: [2, 4, 6] },
    ]);
  });

  test("exposes index alongside item — named loop variable", async () => {
    const { branch } = Action("branch").run(
      Loop(
        ForEach("n", [10, 20, 30]),

        Step("tagged", function () {
          return `${this.n.index}:${this.n.item}`;
        }),
      ),
    );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, string[]>>;

    expect(await branch()).toEqual(["0:10", "1:20", "2:30"]);

    const yields: unknown[] = [];
    for await (const v of branch.stream()) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch" },
      { ">>": "branch.n", items: [10, 20, 30] },
      { ">>": "branch.n[0].tagged", result: "0:10" },
      { ">>": "branch.n[1].tagged", result: "1:20" },
      { ">>": "branch.n[2].tagged", result: "2:30" },
      { ">>": "branch", result: ["0:10", "1:20", "2:30"] },
    ]);
  });

  test("empty array produces empty result", async () => {
    const { branch } = Action("branch").run(
      Loop(
        ForEach(() => []),

        Step("result", function () {
          return this.loop.item;
        }),
      ),
    );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, unknown[]>>;

    expect(await branch()).toEqual([]);

    const yields: unknown[] = [];
    for await (const v of branch.stream()) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch" },
      { ">>": "branch.loop", items: [] },
      { ">>": "branch", result: [] },
    ]);
  });

  test("inner step accesses outer scope", async () => {
    const { branch } = Action("branch")
      .input({ factor: "number" })

      .run(
        Loop(
          ForEach(() => [10, 20, 30]),

          Step("scaled", function () {
            return this.loop.item * this.input.factor;
          }),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, number[]>>;

    expect(await branch({ factor: 3 })).toEqual([30, 60, 90]);

    const yields: unknown[] = [];
    for await (const v of branch.stream({ factor: 3 })) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { factor: 3 } },
      { ">>": "branch.loop", items: [10, 20, 30] },
      { ">>": "branch.loop[0].scaled", result: 30 },
      { ">>": "branch.loop[1].scaled", result: 60 },
      { ">>": "branch.loop[2].scaled", result: 90 },
      { ">>": "branch", result: [30, 60, 90] },
    ]);
  });

  test("items getter receives outer scope", async () => {
    const { branch } = Action("branch").run(
      Step("words", function () {
        return ["hello", "world"];
      }),

      Loop(
        ForEach(({ words }) => words),

        Step("upper", function () {
          return this.loop.item.toUpperCase();
        }),
      ),
    );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, string[]>>;

    expect(await branch()).toEqual(["HELLO", "WORLD"]);

    const yields: unknown[] = [];
    for await (const v of branch.stream()) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch" },
      { ">>": "branch.words", result: ["hello", "world"] },
      { ">>": "branch.loop", items: ["hello", "world"] },
      { ">>": "branch.loop[0].upper", result: "HELLO" },
      { ">>": "branch.loop[1].upper", result: "WORLD" },
      { ">>": "branch", result: ["HELLO", "WORLD"] },
    ]);
  });

  test("loop variable is not in scope after loop", async () => {
    const { branch } = Action("branch")
      .input({ items: "number[]" })

      .run(
        Loop(
          ForEach(({ input }) => input.items),

          Step("doubled", function () {
            return this.loop.item * 2;
          }),
        ),

        Step("check", function () {
          return "loop" in this;
        }),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, boolean>>;

    expect(await branch({ items: [1, 2] })).toEqual(false);

    const yields: unknown[] = [];
    for await (const v of branch.stream({ items: [1, 2] })) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { items: [1, 2] } },
      { ">>": "branch.loop", items: [1, 2] },
      { ">>": "branch.loop[0].doubled", result: 2 },
      { ">>": "branch.loop[1].doubled", result: 4 },
      { ">>": "branch.check", result: false },
      { ">>": "branch", result: false },
    ]);
  });

  test("accumulated array is available to subsequent steps", async () => {
    const { branch } = Action("branch")
      .input({ items: "number[]" })

      .run(
        Loop(
          ForEach(({ input }) => input.items),

          Step("doubled", function () {
            return this.loop.item * 2;
          }),
        ),

        Step("sum", function () {
          return this.doubled.reduce((a, b) => a + b, 0);
        }),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, number>>;

    expect(await branch({ items: [1, 2, 3] })).toEqual(12);

    const yields: unknown[] = [];
    for await (const v of branch.stream({ items: [1, 2, 3] })) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { items: [1, 2, 3] } },
      { ">>": "branch.loop", items: [1, 2, 3] },
      { ">>": "branch.loop[0].doubled", result: 2 },
      { ">>": "branch.loop[1].doubled", result: 4 },
      { ">>": "branch.loop[2].doubled", result: 6 },
      { ">>": "branch.sum", result: 12 },
      { ">>": "branch", result: 12 },
    ]);
  });

  test("multiple inner steps — all accumulated as arrays in outer scope", async () => {
    const { branch } = Action("branch")
      .input({ items: "number[]" })

      .run(
        Loop(
          ForEach(({ input }) => input.items),

          Step("doubled", function () {
            return this.loop.item * 2;
          }),

          Step("label", function () {
            return `${this.loop.item}x2=${this.doubled}`;
          }),
        ),

        Step("summary", function () {
          type check = Expect<Equal<typeof this.doubled, number[]>>;
          type check2 = Expect<Equal<typeof this.label, string[]>>;
          return this.label;
        }),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, string[]>>;

    expect(await branch({ items: [1, 2, 3] })).toEqual([
      "1x2=2",
      "2x2=4",
      "3x2=6",
    ]);

    const yields: unknown[] = [];
    for await (const v of branch.stream({ items: [1, 2, 3] })) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { items: [1, 2, 3] } },
      { ">>": "branch.loop", items: [1, 2, 3] },
      { ">>": "branch.loop[0].doubled", result: 2 },
      { ">>": "branch.loop[0].label", result: "1x2=2" },
      { ">>": "branch.loop[1].doubled", result: 4 },
      { ">>": "branch.loop[1].label", result: "2x2=4" },
      { ">>": "branch.loop[2].doubled", result: 6 },
      { ">>": "branch.loop[2].label", result: "3x2=6" },
      { ">>": "branch.summary", result: ["1x2=2", "2x2=4", "3x2=6"] },
      { ">>": "branch", result: ["1x2=2", "2x2=4", "3x2=6"] },
    ]);
  });

  test("ForEach range generates a numeric sequence", async () => {
    const { branch } = Action("branch").run(
      Loop(
        ForEach({ range: [0, 4] }),

        Step("squared", function () {
          return this.loop.item ** 2;
        }),
      ),
    );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, number[]>>;

    expect(await branch()).toEqual([0, 1, 4, 9]);

    const yields: unknown[] = [];
    for await (const v of branch.stream()) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch" },
      { ">>": "branch.loop", items: [0, 1, 2, 3] },
      { ">>": "branch.loop[0].squared", result: 0 },
      { ">>": "branch.loop[1].squared", result: 1 },
      { ">>": "branch.loop[2].squared", result: 4 },
      { ">>": "branch.loop[3].squared", result: 9 },
      { ">>": "branch", result: [0, 1, 4, 9] },
    ]);
  });

  test("stream yields one event per iteration", async () => {
    const { branch } = Action("branch")
      .input({ items: "number[]" })

      .run(
        Loop(
          ForEach(({ input }) => input.items),

          Step("val", function () {
            return this.loop.item;
          }),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, number[]>>;

    expect(await branch({ items: [1, 2] })).toEqual([1, 2]);

    const yields: unknown[] = [];
    for await (const v of branch.stream({ items: [1, 2] })) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { items: [1, 2] } },
      { ">>": "branch.loop", items: [1, 2] },
      { ">>": "branch.loop[0].val", result: 1 },
      { ">>": "branch.loop[1].val", result: 2 },
      { ">>": "branch", result: [1, 2] },
    ]);
  });

  // ─── Type tests ─────────────────────────────────────────────────────────

  test("type — last is array of inner step return type", () => {
    const { branch } = Action("branch")
      .input({ nums: "number[]" })

      .run(
        Loop(
          ForEach(({ input }) => input.nums),

          Step("doubled", function () {
            return this.loop.item * 2;
          }),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;

    type check = Expect<Equal<RetVal, number[]>>;
  });

  test("type — accumulated key in scope is array", () => {
    Action("branch")
      .input({ nums: "number[]" })

      .run(
        Loop(
          ForEach(({ input }) => input.nums),

          Step("doubled", function () {
            return this.loop.item * 2;
          }),
        ),

        Step("sum", function () {
          type check = Expect<Equal<typeof this.doubled, number[]>>;

          return this.doubled.reduce((a, b) => a + b, 0);
        }),
      );
  });

  test("type — ForEach infers item type from scope", () => {
    Action("branch")
      .input({ items: "number[]" })

      .run(
        Loop(
          ForEach(({ input }) => input.items),

          Step("doubled", function () {
            type check = Expect<
              Equal<typeof this.loop, { item: number; index: number }>
            >;
            return this.loop.item * 2;
          }),
        ),
      );
  });

  test("type — ForEach range produces number items", () => {
    Action("branch").run(
      Loop(
        ForEach({ range: [0, 5] }),

        Step("squared", function () {
          type check = Expect<
            Equal<typeof this.loop, { item: number; index: number }>
          >;
          return this.loop.item ** 2;
        }),
      ),
    );
  });

  // ─── If inside Loop ──────────────────────────────────────────────────────

  test("If inside loop filters items", async () => {
    const { branch } = Action("branch")
      .input({ items: "number[]" })

      .run(
        Loop(
          ForEach(({ input }) => input.items),

          If(
            Cond(({ loop }) => loop.item % 2 === 0),

            Step("even", function () {
              return this.loop.item;
            }),
          ),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, number[]>>;

    expect(await branch({ items: [1, 2, 3, 4] })).toEqual([2, 4]);

    const yields: unknown[] = [];
    for await (const v of branch.stream({ items: [1, 2, 3, 4] }))
      yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { items: [1, 2, 3, 4] } },
      { ">>": "branch.loop", items: [1, 2, 3, 4] },
      { ">>": "branch.loop[1].if.even", result: 2 },
      { ">>": "branch.loop[3].if.even", result: 4 },
      { ">>": "branch", result: [2, 4] },
    ]);
  });

  test("If/Else inside loop tags every item", async () => {
    const { branch } = Action("branch")
      .input({ items: "number[]" })

      .run(
        Loop(
          ForEach(({ input }) => input.items),

          If(
            Cond(({ loop }) => loop.item % 2 !== 0),

            Step("tag", function () {
              return `odd:${this.loop.item}`;
            }),
          ),

          Else(
            Step("tag", function () {
              return `even:${this.loop.item}`;
            }),
          ),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, string[]>>;

    expect(await branch({ items: [1, 2, 3] })).toEqual([
      "odd:1",
      "even:2",
      "odd:3",
    ]);

    const yields: unknown[] = [];
    for await (const v of branch.stream({ items: [1, 2, 3] })) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { items: [1, 2, 3] } },
      { ">>": "branch.loop", items: [1, 2, 3] },
      { ">>": "branch.loop[0].if.tag", result: "odd:1" },
      { ">>": "branch.loop[1].else.tag", result: "even:2" },
      { ">>": "branch.loop[2].if.tag", result: "odd:3" },
      { ">>": "branch", result: ["odd:1", "even:2", "odd:3"] },
    ]);
  });

  test("If condition inside loop accesses outer scope", async () => {
    const { branch } = Action("branch")
      .input({ items: "number[]", threshold: "number" })

      .run(
        Loop(
          ForEach(({ input }) => input.items),

          If(
            Cond(({ loop, input }) => loop.item > input.threshold),

            Step("big", function () {
              return this.loop.item;
            }),
          ),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, number[]>>;

    expect(await branch({ items: [1, 2, 3, 4, 5], threshold: 3 })).toEqual([
      4, 5,
    ]);

    const yields: unknown[] = [];
    for await (const v of branch.stream({
      items: [1, 2, 3, 4, 5],
      threshold: 3,
    }))
      yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { items: [1, 2, 3, 4, 5], threshold: 3 } },
      { ">>": "branch.loop", items: [1, 2, 3, 4, 5] },
      { ">>": "branch.loop[3].if.big", result: 4 },
      { ">>": "branch.loop[4].if.big", result: 5 },
      { ">>": "branch", result: [4, 5] },
    ]);
  });

  test("ElseIf inside loop — three-way branch per item", async () => {
    const { branch } = Action("branch")
      .input({ items: "number[]" })

      .run(
        Loop(
          ForEach(({ input }) => input.items),

          If(
            Cond(({ loop }) => loop.item % 3 === 0),

            Step("tag", function () {
              return "fizz" as const;
            }),
          ),

          ElseIf(
            Cond(({ loop }) => loop.item % 2 === 0),

            Step("tag", function () {
              return "buzz" as const;
            }),
          ),

          Else(
            Step("tag", function () {
              return "other" as const;
            }),
          ),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, ("fizz" | "buzz" | "other")[]>>;

    expect(await branch({ items: [1, 2, 3, 4, 5, 6] })).toEqual([
      "other",
      "buzz",
      "fizz",
      "buzz",
      "other",
      "fizz",
    ]);

    const yields: unknown[] = [];
    for await (const v of branch.stream({ items: [1, 2, 3, 4, 5, 6] }))
      yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { items: [1, 2, 3, 4, 5, 6] } },
      { ">>": "branch.loop", items: [1, 2, 3, 4, 5, 6] },
      { ">>": "branch.loop[0].else.tag", result: "other" },
      { ">>": "branch.loop[1].elseIf.tag", result: "buzz" },
      { ">>": "branch.loop[2].if.tag", result: "fizz" },
      { ">>": "branch.loop[3].elseIf.tag", result: "buzz" },
      { ">>": "branch.loop[4].else.tag", result: "other" },
      { ">>": "branch.loop[5].if.tag", result: "fizz" },
      {
        ">>": "branch",
        result: ["other", "buzz", "fizz", "buzz", "other", "fizz"],
      },
    ]);
  });

  test("multi-step If inside loop — inner steps see each other per iteration", async () => {
    const { branch } = Action("branch")
      .input({ items: "number[]" })

      .run(
        Loop(
          ForEach(({ input }) => input.items),

          If(
            Cond(({ loop }) => loop.item % 2 === 0),

            Step("doubled", function () {
              return this.loop.item * 2;
            }),

            Step("label", function () {
              return `${this.loop.item}*2=${this.doubled}`;
            }),
          ),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, string[]>>;

    expect(await branch({ items: [2, 4] })).toEqual(["2*2=4", "4*2=8"]);

    const yields: unknown[] = [];
    for await (const v of branch.stream({ items: [2, 4] })) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { items: [2, 4] } },
      { ">>": "branch.loop", items: [2, 4] },
      { ">>": "branch.loop[0].if.doubled", result: 4 },
      { ">>": "branch.loop[0].if.label", result: "2*2=4" },
      { ">>": "branch.loop[1].if.doubled", result: 8 },
      { ">>": "branch.loop[1].if.label", result: "4*2=8" },
      { ">>": "branch", result: ["2*2=4", "4*2=8"] },
    ]);
  });

  // ─── Loop inside Loop ────────────────────────────────────────────────────

  test("Loop inside Loop — result is array of inner arrays", async () => {
    const { branch } = Action("branch").run(
      Loop(
        ForEach("outer", [1, 2]),

        Loop(
          ForEach("inner", [10, 20]),

          Step("product", function () {
            return this.outer.item * this.inner.item;
          }),
        ),
      ),
    );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, number[][]>>;

    expect(await branch()).toEqual([
      [10, 20],
      [20, 40],
    ]);

    const yields: unknown[] = [];
    for await (const v of branch.stream()) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch" },
      { ">>": "branch.outer", items: [1, 2] },
      { ">>": "branch.outer[0].inner", items: [10, 20] },
      { ">>": "branch.outer[0].inner[0].product", result: 10 },
      { ">>": "branch.outer[0].inner[1].product", result: 20 },
      { ">>": "branch.outer[1].inner", items: [10, 20] },
      { ">>": "branch.outer[1].inner[0].product", result: 20 },
      { ">>": "branch.outer[1].inner[1].product", result: 40 },
      {
        ">>": "branch",
        result: [
          [10, 20],
          [20, 40],
        ],
      },
    ]);
  });

  test("Loop inside Loop — inner accumulated key available after outer", async () => {
    const { branch } = Action("branch").run(
      Loop(
        ForEach("outer", ["a", "b"]),

        Loop(
          ForEach("inner", [1, 2, 3]),

          Step("tagged", function () {
            return `${this.outer.item}${this.inner.item}`;
          }),
        ),
      ),

      Step("flat", function () {
        return (this.tagged as string[][]).flat();
      }),
    );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, string[]>>;

    expect(await branch()).toEqual(["a1", "a2", "a3", "b1", "b2", "b3"]);

    const yields: unknown[] = [];
    for await (const v of branch.stream()) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch" },
      { ">>": "branch.outer", items: ["a", "b"] },
      { ">>": "branch.outer[0].inner", items: [1, 2, 3] },
      { ">>": "branch.outer[0].inner[0].tagged", result: "a1" },
      { ">>": "branch.outer[0].inner[1].tagged", result: "a2" },
      { ">>": "branch.outer[0].inner[2].tagged", result: "a3" },
      { ">>": "branch.outer[1].inner", items: [1, 2, 3] },
      { ">>": "branch.outer[1].inner[0].tagged", result: "b1" },
      { ">>": "branch.outer[1].inner[1].tagged", result: "b2" },
      { ">>": "branch.outer[1].inner[2].tagged", result: "b3" },
      { ">>": "branch.flat", result: ["a1", "a2", "a3", "b1", "b2", "b3"] },
      { ">>": "branch", result: ["a1", "a2", "a3", "b1", "b2", "b3"] },
    ]);
  });

  test("Loop inside Loop — If inside inner loop still filters", async () => {
    const { branch } = Action("branch")
      .input({ inner: "number[]" })

      .run(
        Loop(
          ForEach("outer", () => [2, 3]),

          Loop(
            ForEach("inner", ({ input }) => input.inner),

            If(
              Cond(({ inner }) => inner.item % 2 === 0),

              Step("even", function () {
                return this.outer.item * this.inner.item;
              }),
            ),
          ),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, number[][]>>;

    expect(await branch({ inner: [1, 2, 3, 4] })).toEqual([
      [4, 8],
      [6, 12],
    ]);

    const yields: unknown[] = [];
    for await (const v of branch.stream({ inner: [1, 2, 3, 4] }))
      yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { inner: [1, 2, 3, 4] } },
      { ">>": "branch.outer", items: [2, 3] },
      { ">>": "branch.outer[0].inner", items: [1, 2, 3, 4] },
      { ">>": "branch.outer[0].inner[1].if.even", result: 4 },
      { ">>": "branch.outer[0].inner[3].if.even", result: 8 },
      { ">>": "branch.outer[1].inner", items: [1, 2, 3, 4] },
      { ">>": "branch.outer[1].inner[1].if.even", result: 6 },
      { ">>": "branch.outer[1].inner[3].if.even", result: 12 },
      {
        ">>": "branch",
        result: [
          [4, 8],
          [6, 12],
        ],
      },
    ]);
  });

  test("Loop > If > Loop — inner loop runs only for matching outer items", async () => {
    const { branch } = Action("branch")
      .input({ inner: "number[]" })

      .run(
        Loop(
          ForEach("outer", () => [1, 2, 3, 4]),

          If(
            Cond(({ outer }) => outer.item % 2 === 0),

            Loop(
              ForEach("inner", ({ input }) => input.inner),

              Step("product", function () {
                return this.outer.item * this.inner.item;
              }),
            ),
          ),
        ),
      );

    type T = typeof branch;
    type RetVal = Awaited<ReturnType<T>>;
    type check = Expect<Equal<RetVal, number[][]>>;

    expect(await branch({ inner: [10, 20] })).toEqual([
      [20, 40],
      [40, 80],
    ]);

    const yields: unknown[] = [];
    for await (const v of branch.stream({ inner: [10, 20] })) yields.push(v);
    expect(eventDataList(yields)).toEqual([
      { ">>": "branch", input: { inner: [10, 20] } },
      { ">>": "branch.outer", items: [1, 2, 3, 4] },
      { ">>": "branch.outer[1].if.inner", items: [10, 20] },
      { ">>": "branch.outer[1].if.inner[0].product", result: 20 },
      { ">>": "branch.outer[1].if.inner[1].product", result: 40 },
      { ">>": "branch.outer[3].if.inner", items: [10, 20] },
      { ">>": "branch.outer[3].if.inner[0].product", result: 40 },
      { ">>": "branch.outer[3].if.inner[1].product", result: 80 },
      {
        ">>": "branch",
        result: [
          [20, 40],
          [40, 80],
        ],
      },
    ]);
  });
});
