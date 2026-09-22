import { expect, expectTypeOf, mock, test } from "bun:test";
import { Actor, Step } from "@taskwish/core";

import {
  ModelChoice,
  ModelNoul,
  ModelScore,
  TypeSafe,
  assertProbability,
  type ModelAnswerFor,
} from "./typesafe";

test("validates TypeSafe probabilities and confidence values", () => {
  expect(() => assertProbability("confidence", 0)).not.toThrow();
  expect(() => assertProbability("confidence", 1)).not.toThrow();
  expect(() => assertProbability("confidence", -0.01)).toThrow(
    "invalid confidence probability",
  );
  expect(() => assertProbability("confidence", 1.01)).toThrow(
    "invalid confidence probability",
  );
  expect(() => assertProbability("confidence", Number.NaN)).toThrow(
    "invalid confidence probability",
  );
});

test("runs a typed TypeSafe request as a workflow step", async () => {
  const fetchMock = mock(async () =>
    Response.json({
      model: "jev-test",
      answers: {
        outcome: {
          type: "choice",
          choice: "healthy",
          confidence: 0.95,
          probabilities: { healthy: 0.95, failed: 0.05 },
        },
      },
      usage: { input_tokens: 10, output_tokens: 2 },
    }),
  );
  const { actor } = Actor("TypeSafeTest");
  const { evaluate } = actor()
    .on("Command", "evaluate")
    .run(
      Step("prepare", function () {
        return { message: "The run completed." };
      }),
      TypeSafe(
        "decision",
        {
          state: (scope) => scope.prepare,
          questions: {
            outcome: ModelChoice("Choose an outcome", {
              healthy: null,
              failed: null,
            }),
          },
        },
        {
          apiKey: "test-key",
          defaultModel: "jev-test",
          fetch: fetchMock,
        },
      ),
      Step("selected", function () {
        expectTypeOf(this.decision.answers.outcome.choice).toEqualTypeOf<
          "healthy" | "failed"
        >();
        return this.decision.answers.outcome.choice;
      }),
    );

  await expect(evaluate()).resolves.toBe("healthy");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("builds TypeSafe questions with Python-style model constructors", () => {
  expect(ModelNoul("Is the task complete?")).toEqual({
    type: "noul",
    instructions: "Is the task complete?",
  });
  expect(
    ModelChoice("Choose an outcome", {
      healthy: "Completed successfully",
      failed: "Did not complete",
    }),
  ).toEqual({
    type: "choice",
    instructions: "Choose an outcome",
    criteria: {
      healthy: "Completed successfully",
      failed: "Did not complete",
    },
  });
  expect(ModelScore("Rate urgency", ["none", "normal", "urgent"])).toEqual({
    type: "score",
    instructions: "Rate urgency",
    criteria: ["none", "normal", "urgent"],
  });
});

test("preserves choice labels in the inferred answer type", () => {
  const question = ModelChoice("Choose an outcome", {
    healthy: null,
    failed: null,
  });
  type Answer = ModelAnswerFor<typeof question>;

  expectTypeOf<Answer["choice"]>().toEqualTypeOf<"healthy" | "failed">();
  expectTypeOf<keyof Answer["probabilities"]>().toEqualTypeOf<
    "healthy" | "failed"
  >();
});
