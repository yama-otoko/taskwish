import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { TW } from "@taskwish/core";

import type { TaskWishLanguageModel } from "./ai-sdk-agent";

export type ProviderDefinition<
  Name extends string,
  Models extends readonly string[],
> = TW.AIProvider<Name, Models, TaskWishLanguageModel>;

export type ProviderModelName<Provider> = Provider extends {
  provider: infer Name extends string;
  models: readonly (infer Model extends string)[];
}
  ? `${Name}/${Model}`
  : never;

type PascalCase<Name extends string> = Name extends Capitalize<Name>
  ? Name
  : ["Expected PascalCase provider name", Name];

/** Registers one or more OpenAI-compatible models under a provider prefix. */
export function Provider<
  const Name extends string,
  const Models extends readonly string[]
>(
  name: PascalCase<Name>,
  options: Omit<Parameters<typeof createOpenAICompatible>[0], "name"> & {
    models: Models;
  }
): Record<Name, TW.AIProvider<Name, Models, TaskWishLanguageModel>> {
  const { models, ...settings } = options;
  const provider = createOpenAICompatible({
    ...settings,
    name: (name as string).toLowerCase(),
  });

  const definition = defineProvider(name as Name, models, provider);

  return { [name as string]: definition } as Record<
    Name,
    TW.AIProvider<Name, Models, TaskWishLanguageModel>
  >;
}

export function defineProvider<
  const Name extends string,
  const Models extends readonly string[],
>(
  name: Name,
  models: Models,
  createModel: (modelId: string) => TaskWishLanguageModel,
): ProviderDefinition<Name, Models> {
  const providerName = name.toLowerCase() as Lowercase<Name>;
  const modelCache = new Map<Models[number], TaskWishLanguageModel>();
  const registration: TW.AIProviderRegistration<
    Name,
    Models,
    TaskWishLanguageModel
  > = {
    provider: providerName,
    models,
    model: (modelId) => {
      let model = modelCache.get(modelId);
      if (!model) {
        model = createModel(modelId);
        modelCache.set(modelId, model);
      }
      return model;
    },
  };
  const definition = {
    ...registration,
    [TW.Scope]: {
      [TW.Provider]: { [name as string]: registration },
    },
  } as TW.AIProvider<Name, Models, TaskWishLanguageModel>;

  return definition;
}
