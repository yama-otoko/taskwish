import { createGoogle } from "@ai-sdk/google";

import { defineProvider } from "../provider";

/** Gemini and Gemma text models supported by the installed Google adapter. */
export const GoogleModels = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash-lite-001",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash-preview-tts",
  "gemini-2.5-pro-preview-tts",
  "gemini-2.5-flash-native-audio-latest",
  "gemini-2.5-flash-native-audio-preview-09-2025",
  "gemini-2.5-flash-native-audio-preview-12-2025",
  "gemini-2.5-computer-use-preview-10-2025",
  "gemini-3-pro-preview",
  "gemini-3-pro-image-preview",
  "gemini-3-flash-preview",
  "gemini-3.1-pro-preview",
  "gemini-3.1-pro-preview-customtools",
  "gemini-3.1-flash-image-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-3.1-flash-tts-preview",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3.8-flash",
  "gemini-pro-latest",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "deep-research-pro-preview-12-2025",
  "deep-research-max-preview-04-2026",
  "deep-research-preview-04-2026",
  "nano-banana-pro-preview",
  "aqa",
  "gemini-robotics-er-1.5-preview",
  "gemma-3-1b-it",
  "gemma-3-4b-it",
  "gemma-3n-e4b-it",
  "gemma-3n-e2b-it",
  "gemma-3-12b-it",
  "gemma-3-27b-it",
] as const;

export type GoogleModel = (typeof GoogleModels)[number];

/** Ready-to-use Google provider. Authentication comes from the environment. */
export const Google = defineProvider(
  "Google",
  GoogleModels,
  createGoogle({ apiKey: process.env.TW_GOOGLE_AI_KEY }),
);
