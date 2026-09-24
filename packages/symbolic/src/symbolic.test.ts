import { describe, expect, test } from "bun:test";

import { Actor, Step, TW } from "@taskwish/core";
import { messageLogData } from "@taskwish/wind";

import { Function, Int, Model, Real, RealSort } from "./steps";

const eventDataList = (values: unknown[]) => values.map(messageLogData);

describe("Symbolic", () => {
  test("Model supports declared symbolic functions", async () => {
    const { actor } = Actor("Functions");

    const { solve } = actor()
      .on("Command", "solve")

      .run(
        Real("x", "y"),

        Function("squareRoot", RealSort(), RealSort()),

        Model(
          "functionModel",
          ({ squareRoot, x, y }) => y == squareRoot(x),
          ({ x }) => x == 4,
          ({ y }) => y == 2,
        ),

        Step("result", function () {
          return this.functionModel.solve();
        }),
      );

    await expect(solve()).resolves.toEqual({ x: 4, y: 2 });
  });

  test("Model.prove runs as an actor step and returns status with model", async () => {
    const { actor } = Actor("Solver");

    const { solve } = actor()
      .on("Command", "solve")

      .run(
        Int("x", "y"),

        Real("z"),

        Model(
          "equationModel",

          ({ x }) => x > 2,
          ({ y }) => y < 10,
          ({ x, y }) => x + 2 * y == 7,
          ({ x }) => x == 3,
          ({ y }) => y ** 2 == 4,
          ({ z }) => z == 1.5
        ),

        Step("result", function () {
          return this.equationModel.prove();
        })
      );

    type T = typeof solve;
    const actionName: T[typeof TW.Name] = "Solver::solve";
    expect(actionName).toBe("Solver::solve");

    const result = await solve();

    expect(result.status).toBe("sat");
    if (result.status !== "sat") throw new Error("Expected sat result");

    expect(result.model).toMatchObject({ x: 3, y: 2, z: 1.5 });
    expect("solutions" in result).toBe(false);
    expect("smtScript" in result).toBe(false);
    expect("output" in result).toBe(false);
  });

  test("Model.solve returns the model directly", async () => {
    const { actor } = Actor("Solver");

    const { solve } = actor()
      .on("Command", "solve")

      .run(
        Int("x"),

        Model("constantModel", ({ x }) => x == 4),

        Step("result", function () {
          return this.constantModel.solve();
        })
      );

    await expect(solve()).resolves.toEqual({ x: 4 });
  });

  test("Model.solve supports optional fixed inputs", async () => {
    const { actor } = Actor("Solver");

    const { solve } = actor()
      .on("Command", "solve")

      .run(
        Int("x", "y"),

        Model(
          "sumModel",

          ({ x, y }) => x + y == 10,
          ({ x, y }) => x + 3 >= y - 4
        ),

        Step("model", function () {
          return this.sumModel.solve({ x: 2 });
        })
      );

    await expect(solve()).resolves.toEqual({ x: 2, y: 8 });
  });

  test("Model validates fixed inputs against declarations", async () => {
    const { actor } = Actor("Solver");

    const { solve } = actor()
      .on("Command", "solve")

      .run(
        Int("x"),

        Model("positiveModel", ({ x }) => x > 0),

        Step("model", function () {
          //@ts-ignore
          return this.positiveModel.solve({ y: 1 });
        })
      );

    await expect(solve()).rejects.toThrow(
      'Cannot solve symbolic model with unknown variable "y"'
    );
  });

  test("Model.solve throws when the constraints are not sat", async () => {
    const { actor } = Actor("Solver");

    const { solve } = actor()
      .on("Command", "solve")

      .run(
        Int("x"),

        Model(
          "contradictionModel",

          ({ x }) => x == 1,
          ({ x }) => x == 2
        ),

        Step("model", function () {
          return this.contradictionModel.solve();
        })
      );

    await expect(solve()).rejects.toThrow("Expected sat, got unsat");
  });

  test("Model.solveAll yields each model as a pipeable async generator", async () => {
    const { actor } = Actor("Solver");

    const { solve } = actor()
      .on("Command", "solve")

      .run(
        Int("x"),

        Model(
          "rangeModel",

          ({ x }) => x > 0,
          ({ x }) => x < 3
        ),

        Step("solutions", function () {
          return this.rangeModel.solveAll();
        }),

        Step(["|>", "models"], async function* (source) {
          for await (const model of source) {
            yield model.x;
          }
        })
      );

    const values: unknown[] = [];
    for await (const value of solve.stream()) values.push(value);

    const models = eventDataList(values).filter(
      (value): value is number => typeof value === "number"
    );
    expect(models.sort()).toEqual([1, 2]);
  });

  test("Model emits step traces inside an actor stream", async () => {
    const { actor } = Actor("Solver");

    const { solve } = actor()
      .on("Command", "solve")

      .run(
        Int("x"),

        Model("unitModel", ({ x }) => x == 1),

        Step("model", function () {
          return this.unitModel.solve();
        })
      );

    const yields: unknown[] = [];
    for await (const value of solve.stream()) yields.push(value);

    expect(eventDataList(yields)).toMatchObject([
      { ">>": "Solver::solve", input: undefined },
      { ">>": "Solver::solve.symbolic.Int.x" },
      { ">>": "Solver::solve.unitModel" },
      { ">>": "Solver::solve.model", result: { x: 1 } },
      { ">>": "Solver::solve", result: { x: 1 } },
    ]);
  });

  test("Model.prove returns accounting status from known line items", async () => {
    const { actor } = Actor("Accounting").scope(
      Int(
        "grossRevenue",
        "refunds",
        "netRevenue",
        "costOfGoods",
        "operatingExpenses",
        "taxableIncome",
        "tax",
        "netIncome"
      ),

      Model(
        "incomeStatement",

        ({ grossRevenue, refunds, netRevenue }) =>
          netRevenue == grossRevenue - refunds,

        ({ netRevenue, costOfGoods, operatingExpenses, taxableIncome }) =>
          taxableIncome == netRevenue - costOfGoods - operatingExpenses,

        ({ taxableIncome, tax }) => tax == taxableIncome / 5,

        ({ taxableIncome, tax, netIncome }) => netIncome == taxableIncome - tax
      )
    );

    const { forecast } = actor()
      .on("Command", "forecast")

      .run(
        Step("forecast", function () {
          return this.incomeStatement.prove({
            grossRevenue: 125000,
            refunds: 5000,
            costOfGoods: 45000,
            operatingExpenses: 25000,
          });
        })
      );

    const result = await forecast();

    expect(result.status).toBe("sat");
    if (result.status !== "sat") throw new Error("Expected sat result");

    expect(result.model).toMatchObject({
      grossRevenue: 125000,
      refunds: 5000,
      netRevenue: 120000,
      costOfGoods: 45000,
      operatingExpenses: 25000,
      taxableIncome: 50000,
      tax: 10000,
      netIncome: 40000,
    });
  });

  test("Model solves a missing accounting input from a desired outcome", async () => {
    const { actor } = Actor("Accounting").scope(
      Int(
        "grossRevenue",
        "refunds",
        "netRevenue",
        "costOfGoods",
        "operatingExpenses",
        "taxableIncome",
        "tax",
        "netIncome"
      ),

      Model(
        "incomeStatement",

        ({ grossRevenue, refunds, netRevenue }) =>
          netRevenue == grossRevenue - refunds,

        ({ netRevenue, costOfGoods, operatingExpenses, taxableIncome }) =>
          taxableIncome == netRevenue - costOfGoods - operatingExpenses,

        ({ taxableIncome, tax }) => tax == taxableIncome / 5,

        ({ taxableIncome, tax, netIncome }) => netIncome == taxableIncome - tax
      )
    );

    const { forecast } = actor()
      .on("Command", "forecast")

      .run(
        Step("forecast", function () {
          return this.incomeStatement.solve({
            grossRevenue: 125000,
            refunds: 5000,
            costOfGoods: 45000,
            netIncome: 40000,
          });
        })
      );

    await expect(forecast()).resolves.toMatchObject({
      netRevenue: 120000,
      taxableIncome: 50000,
      tax: 10000,
      operatingExpenses: 25000,
      netIncome: 40000,
    });
  });
});
