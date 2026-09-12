import { afterEach, expect, mock, test } from "bun:test";

import type { ExtractedObservations } from "../shared/observations";
import { EquipmentDiagnostician } from ".";

const originalKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
});

function observations(
  overrides: Partial<ExtractedObservations> = {},
): ExtractedObservations {
  const unknown = { state: "unknown" as const, evidence: null };
  return {
    motorStarts: unknown,
    breakerTripped: unknown,
    shaftTurns: unknown,
    loudHum: unknown,
    overheating: unknown,
    burningSmell: unknown,
    lowAirflow: unknown,
    summary: "A technician inspected the fan.",
    concerns: [],
    ...overrides,
  };
}

test("combines neural extraction, symbolic rules, and grounded explanation", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const perception = mock(
    async (_options: { prompt: string; abortSignal?: AbortSignal }) =>
      observations({
        motorStarts: { state: "present", evidence: "motor starts" },
        shaftTurns: { state: "absent", evidence: "shaft does not turn" },
        loudHum: { state: "present", evidence: "loud humming" },
        burningSmell: { state: "absent", evidence: "no burning smell" },
      }),
  );
  const explanation = mock(
    async (_options: { prompt: string; abortSignal?: AbortSignal }) =>
      "The motor runs while the shaft is stationary, so the mechanical-jam rule fired.",
  );

  const result = await EquipmentDiagnostician.diagnoseReport
    .ctx({
      perceptionAgent: { generate: perception },
      explanationAgent: { generate: explanation },
    })
    .run({ report: "Motor starts and hums, but the shaft does not turn." });

  expect(result.diagnosis).toEqual({
    electricalFault: false,
    mechanicalJam: true,
    airflowObstruction: false,
    urgentStop: false,
    inconsistentEvidence: false,
    diagnosisUnresolved: false,
    symbolicCalculation: "sat",
  });
  expect(result.explanation).toContain("mechanical-jam rule");
  expect(perception).toHaveBeenCalledTimes(1);
  expect(explanation).toHaveBeenCalledTimes(1);
  expect(explanation.mock.calls[0]?.[0]?.prompt).toContain(
    '"mechanicalJam":true',
  );
});

test("fails closed on conflicting or hazardous evidence", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const perception = mock(async () =>
    observations({
      motorStarts: {
        state: "conflicted",
        evidence: "starts once, then reported as unable to start",
      },
      burningSmell: { state: "present", evidence: "burning odor" },
    }),
  );
  const explanation = mock(async () => "Stop and request qualified inspection.");

  const result = await EquipmentDiagnostician.diagnoseReport
    .ctx({
      perceptionAgent: { generate: perception },
      explanationAgent: { generate: explanation },
    })
    .run({ report: "Conflicting startup reports and a burning odor." });

  expect(result.diagnosis).toMatchObject({
    urgentStop: true,
    inconsistentEvidence: true,
    diagnosisUnresolved: true,
  });
});

test("rejects malformed neural output before symbolic reasoning", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const explanation = mock(async () => "unused");

  await expect(
    EquipmentDiagnostician.diagnoseReport
      .ctx({
        perceptionAgent: {
          generate: mock(
            async () =>
              ({ motorStarts: "probably" }) as unknown as ExtractedObservations,
          ),
        },
        explanationAgent: { generate: explanation },
      })
      .run({ report: "The motor probably started." }),
  ).rejects.toThrow("Invalid observation structure");
  expect(explanation).not.toHaveBeenCalled();
});

test("rejects invalid input before invoking either agent", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const perception = mock(async () => observations());
  const explanation = mock(async () => "unused");

  await expect(
    EquipmentDiagnostician.diagnoseReport
      .ctx({
        perceptionAgent: { generate: perception },
        explanationAgent: { generate: explanation },
      })
      .run({ report: " " }),
  ).rejects.toThrow("1–20,000");
  expect(perception).not.toHaveBeenCalled();
  expect(explanation).not.toHaveBeenCalled();
});
