import { expect, mock, test } from "bun:test";

import { LoadExtractor } from ".";
import type { Load } from "../shared/load";
import { sampleLoad } from "../shared/test-helpers";

test("uses the Agent and parses its structured output", async () => {
  const generate = mock(
    async (_options: { prompt: string; abortSignal?: AbortSignal }) =>
      sampleLoad(),
  );
  await expect(
    LoadExtractor.extractLoad
      .ctx({ agent: { generate } })
      .run({ markdown: "Load tender" })
  ).resolves.toEqual(sampleLoad());
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate.mock.calls[0]?.[0]).toMatchObject({
    prompt: "Load tender",
    abortSignal: expect.any(AbortSignal),
  });
});

test("fails closed when the Agent returns an invalid load", async () => {
  await expect(
    LoadExtractor.extractLoad
      .ctx({
        agent: {
          generate: mock(
            async (): Promise<Load> =>
              ({ reference: "guessed" }) as unknown as Load,
          ),
        },
      })
      .run({ markdown: "Load tender" })
  ).rejects.toThrow("Invalid load structure");
});

test("validates source text before invoking the Agent", async () => {
  const generate = mock(async () => sampleLoad());
  await expect(
    LoadExtractor.extractLoad
      .ctx({ agent: { generate } })
      .run({ markdown: " " })
  ).rejects.toThrow(
    "1–120,000"
  );
  expect(generate).not.toHaveBeenCalled();
});
