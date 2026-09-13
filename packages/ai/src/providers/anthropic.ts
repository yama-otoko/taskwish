import { createAnthropic } from "@ai-sdk/anthropic";

import { defineProvider } from "../provider";

/** Claude text models supported by the installed Anthropic AI SDK adapter. */
export const AnthropicModels = [
  "claude-3-haiku-20240307",
  "claude-haiku-4-5-20251001",
  "claude-haiku-4-5",
  "claude-opus-4-0",
  "claude-opus-4-20250514",
  "claude-opus-4-1-20250805",
  "claude-opus-4-1",
  "claude-opus-4-5",
  "claude-opus-4-5-20251101",
  "claude-sonnet-4-0",
  "claude-sonnet-4-20250514",
  "claude-sonnet-4-5-20250929",
  "claude-sonnet-4-5",
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-opus-5",
  "claude-fable-5",
  "claude-fable-5-1",
  "claude-sonnet-5",
] as const;

export type AnthropicModel = (typeof AnthropicModels)[number];

/** Ready-to-use Anthropic provider. Authentication comes from the environment. */
export const Anthropic = defineProvider(
  "Anthropic",
  AnthropicModels,
  createAnthropic({ apiKey: process.env.TW_ANTHROPIC_KEY }),
);
