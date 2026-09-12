import { type } from "arktype";

export const observationNames = [
  "motorStarts",
  "breakerTripped",
  "shaftTurns",
  "loudHum",
  "overheating",
  "burningSmell",
  "lowAirflow",
] as const;

export type ObservationName = (typeof observationNames)[number];
export type ObservationState =
  | "present"
  | "absent"
  | "unknown"
  | "conflicted";

export type Observation = {
  state: ObservationState;
  evidence: string | null;
};

export type ExtractedObservations = Record<ObservationName, Observation> & {
  summary: string;
  concerns: string[];
};

const observationDefinition = {
  state: "'present' | 'absent' | 'unknown' | 'conflicted'",
  evidence: "string | null",
} as const;

const ExtractedObservationsType = type({
  motorStarts: observationDefinition,
  breakerTripped: observationDefinition,
  shaftTurns: observationDefinition,
  loudHum: observationDefinition,
  overheating: observationDefinition,
  burningSmell: observationDefinition,
  lowAirflow: observationDefinition,
  summary: "string",
  concerns: "string[]",
});

const observationJsonSchema = {
  type: "object",
  properties: {
    state: {
      type: "string",
      enum: ["present", "absent", "unknown", "conflicted"],
    },
    evidence: { type: ["string", "null"] },
  },
  required: ["state", "evidence"],
  additionalProperties: false,
};

export const observationsJsonSchema = {
  type: "object",
  properties: {
    ...Object.fromEntries(
      observationNames.map((name) => [name, observationJsonSchema]),
    ),
    summary: { type: "string" },
    concerns: { type: "array", items: { type: "string" } },
  },
  required: [...observationNames, "summary", "concerns"],
  additionalProperties: false,
};

export function parseObservations(value: unknown): ExtractedObservations {
  const result = ExtractedObservationsType(value);
  if (result instanceof type.errors) {
    throw new Error(`Invalid observation structure: ${result.summary}`);
  }
  return result as ExtractedObservations;
}

export function symbolicFlags(observation: Observation) {
  return {
    known:
      observation.state === "present" || observation.state === "absent",
    value: observation.state === "present",
    conflict: observation.state === "conflicted",
  };
}
