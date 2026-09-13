import { describe, expect, expectTypeOf, test } from "bun:test";

import { Actor, Step, TW } from "@taskwish/core";

import { Agent } from "./agent";
import { Provider, type ProviderModelName } from "./provider";
import { Anthropic, Google, OpenAI } from "./providers";

describe("Provider", () => {
  test("registers each model under its provider-qualified name", () => {
    const { Ollama } = Provider("Ollama", {
      baseURL: "http://127.0.0.1:11434/v1",
      models: ["qwen3:4b", "qwen3:8b"],
    });
    const scope = Ollama[TW.Scope];
    const providers = scope[TW.Provider];
    type ModelName = ProviderModelName<
      (typeof providers)[keyof typeof providers]
    >;

    expect(Object.keys(scope)).toEqual([]);
    expect(Object.keys(providers)).toEqual(["Ollama"]);
    expect(providers.Ollama.models).toEqual(["qwen3:4b", "qwen3:8b"]);
    expectTypeOf<ModelName>().toEqualTypeOf<
      "ollama/qwen3:4b" | "ollama/qwen3:8b"
    >();
    expect((providers.Ollama.model("qwen3:4b") as any).modelId).toBe(
      "qwen3:4b"
    );
  });

  test("first-party adapters register their typed model catalogs", () => {
    const providers = [Anthropic, OpenAI, Google];

    expect(providers.map((provider) => provider.provider)).toEqual([
      "anthropic",
      "openai",
      "google",
    ]);

    expectTypeOf<"anthropic/claude-sonnet-4-6">().toMatchTypeOf<
      ProviderModelName<typeof Anthropic>
    >();
    expectTypeOf<"openai/gpt-6-astra">().toMatchTypeOf<
      ProviderModelName<typeof OpenAI>
    >();
    expectTypeOf<"google/gemini-3.1-pro-preview">().toMatchTypeOf<
      ProviderModelName<typeof Google>
    >();

    for (const provider of providers) {
      const model = provider.model(provider.models[0] as never);
      expect((model as any).modelId).toBe(provider.models[0]);
      expect(provider.model(provider.models[0] as never)).toBe(model);
    }
  });

  test("makes built-in models available in actor scope", async () => {
    const expectedModel = Anthropic.model("claude-sonnet-4-6");
    const { actor } = Actor("ProviderCatalog")
      .use(Anthropic)
      .use(OpenAI)
      .use(Google);
    const { inspectModel } = actor()
      .on("Command", "inspectModel")

      .run(
        Agent({ model: "anthropic/claude-sonnet-4-6" }),

        Step("model", function () {
          return (this.agent.client as any).client.settings.model;
        }),
      );

    await expect(inspectModel()).resolves.toBe(expectedModel);
  });
});
