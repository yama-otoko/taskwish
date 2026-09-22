import {
  choice,
  type EntryType,
  noul,
  score,
  TypeSafeClient,
  type ChoiceCriteria,
  type ChoiceQuestion,
  type ChoiceResponse,
  type NoulQuestion,
  type NoulResponse,
  type Questions,
  type ResultFor,
  type ScoreCriteria,
  type ScoreQuestion,
  type ScoreResponse,
  type SystemOneRequest,
  type SystemOneResult,
  type TypeSafeClientConfig,
} from "@typesafe-ai/sdk";
import { Step, type StepDefinition, type StepScope } from "@taskwish/core";

export type TypeSafeStepOptions<
  Ctx extends Record<any, any>,
  Q extends Questions,
> = Omit<SystemOneRequest<Q>, "state"> & {
  state: EntryType | ((scope: StepScope<Ctx>) => EntryType | Promise<EntryType>);
};

/** TypeSafe System One client, re-exported as part of TaskWish AI. */
export { TypeSafeClient };

/** Creates a TypeSafe yes/no probability question. */
export const ModelNoul = noul;

/** Creates a TypeSafe closed-set choice question. */
export const ModelChoice = choice;

/** Creates a TypeSafe ordered score question. */
export const ModelScore = score;

/** Ensures a TypeSafe probability or confidence value is within zero and one. */
export function assertProbability(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`TypeSafe returned an invalid ${name} probability.`);
  }
}

/**
 * Runs a TypeSafe System One request as a named TaskWish workflow step.
 * A state resolver receives the same typed scope as a `Step` handler.
 */
export function TypeSafe<
  Ctx extends Record<any, any>,
  const Name extends string,
  const Q extends Questions,
>(
  name: Name,
  options: TypeSafeStepOptions<Ctx, Q>,
  config: TypeSafeClientConfig = {},
): StepDefinition<Name, Ctx, SystemOneResult<Q>> {
  return (Step as any)(name, async function (this: StepScope<Ctx>) {
    const state =
      typeof options.state === "function"
        ? await options.state(this)
        : options.state;
    const client = new TypeSafeClient({
      ...config,
      defaultModel:
        config.defaultModel ?? process.env.TYPESAFE_MODEL ?? "jev-latest",
      timeout:
        config.timeout ?? Number(process.env.TYPESAFE_TIMEOUT_MS ?? 30_000),
    });
    return client.systemOne({ ...options, state });
  }) as never;
}

export type {
  ChoiceCriteria as ModelChoiceCriteria,
  ChoiceQuestion as ModelChoiceQuestion,
  ChoiceResponse as ModelChoiceAnswer,
  NoulQuestion as ModelNoulQuestion,
  NoulResponse as ModelNoulAnswer,
  Questions as ModelQuestions,
  ResultFor as ModelAnswerFor,
  ScoreCriteria as ModelScoreCriteria,
  ScoreQuestion as ModelScoreQuestion,
  ScoreResponse as ModelScoreAnswer,
  SystemOneRequest as ModelRequest,
  SystemOneResult as ModelResult,
  TypeSafeClientConfig,
};
