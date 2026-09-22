const DEFAULT_BASE_URL = "https://api.typesafe.ai";
const DEFAULT_TIMEOUT_MS = 30_000;

export type NoulQuestion = {
  type: "noul";
  instructions?: unknown;
  criteria?: { true?: unknown; false?: unknown };
};

export type ChoiceQuestion = {
  type: "choice";
  instructions?: unknown;
  criteria: Record<string, unknown>;
};

export type ScoreQuestion = {
  type: "score";
  instructions?: unknown;
  criteria: unknown[];
};

export type SystemOneQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type NoulAnswer = { type: "noul"; noul: number };
export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};
export type ScoreAnswer = {
  type: "score";
  score: number;
  confidence: number;
  legend: Record<string, unknown>;
  probabilities: Record<string, number>;
};
export type SystemOneAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type SystemOneResponse = {
  model: string;
  answers: Record<string, SystemOneAnswer>;
  usage: { input_tokens: number; output_tokens: number };
};

export async function systemOne(input: {
  state: unknown;
  questions: Record<string, SystemOneQuestion>;
  model?: string;
}): Promise<SystemOneResponse> {
  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Set TYPESAFE_API_KEY before using the TypeSafe actor.");
  }

  const timeoutMs = Number(
    process.env.TYPESAFE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
  );
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("TYPESAFE_TIMEOUT_MS must be a positive integer.");
  }

  const response = await fetch(`${baseUrl()}/v1/systemone`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      state: input.state,
      model: input.model ?? process.env.TYPESAFE_MODEL ?? "jev-latest",
      questions: input.questions,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      `TypeSafe system-one request failed (${response.status}): ${errorDetail(body)}`,
    );
  }
  return validateResponse(body);
}

function validateResponse(value: unknown): SystemOneResponse {
  if (!isRecord(value) || typeof value.model !== "string") {
    throw new Error("TypeSafe returned an invalid response envelope.");
  }
  if (!isRecord(value.answers) || !isRecord(value.usage)) {
    throw new Error("TypeSafe returned no answers or usage data.");
  }
  if (
    !isNonNegativeInteger(value.usage.input_tokens) ||
    !isNonNegativeInteger(value.usage.output_tokens)
  ) {
    throw new Error("TypeSafe returned invalid token usage.");
  }

  const answers: Record<string, SystemOneAnswer> = {};
  for (const [name, answer] of Object.entries(value.answers)) {
    answers[name] = validateAnswer(name, answer);
  }
  if (Object.keys(answers).length === 0) {
    throw new Error("TypeSafe returned no answers.");
  }
  return {
    model: value.model,
    answers,
    usage: {
      input_tokens: value.usage.input_tokens,
      output_tokens: value.usage.output_tokens,
    },
  };
}

function validateAnswer(name: string, value: unknown): SystemOneAnswer {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error(`TypeSafe returned an invalid answer for ${name}.`);
  }
  if (value.type === "noul" && isProbability(value.noul)) {
    return { type: "noul", noul: value.noul };
  }
  if (
    value.type === "choice" &&
    typeof value.choice === "string" &&
    isProbability(value.confidence) &&
    isProbabilityMap(value.probabilities)
  ) {
    return {
      type: "choice",
      choice: value.choice,
      confidence: value.confidence,
      probabilities: value.probabilities,
    };
  }
  if (
    value.type === "score" &&
    typeof value.score === "number" &&
    Number.isFinite(value.score) &&
    isProbability(value.confidence) &&
    isRecord(value.legend) &&
    isProbabilityMap(value.probabilities)
  ) {
    return {
      type: "score",
      score: value.score,
      confidence: value.confidence,
      legend: value.legend,
      probabilities: value.probabilities,
    };
  }
  throw new Error(`TypeSafe returned an invalid ${value.type} answer for ${name}.`);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`TypeSafe returned non-JSON data (${response.status}).`);
  }
}

function errorDetail(value: unknown): string {
  if (isRecord(value) && "detail" in value) {
    return typeof value.detail === "string"
      ? value.detail
      : JSON.stringify(value.detail);
  }
  return "request failed";
}

function baseUrl(): string {
  return (process.env.TYPESAFE_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}

function isProbabilityMap(value: unknown): value is Record<string, number> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => isProbability(entry))
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
