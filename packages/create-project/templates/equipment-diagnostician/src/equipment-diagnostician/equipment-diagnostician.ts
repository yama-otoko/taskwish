import { Actor, OpenAI } from "taskwish";
import { Bool, Model } from "@taskwish/symbolic";

export const { actor } = Actor("EquipmentDiagnostician")
  .use(OpenAI)

  .scope(
    Bool(
      "motorKnown",
      "motorStarts",
      "motorConflict",
      "breakerKnown",
      "breakerTripped",
      "breakerConflict",
      "shaftKnown",
      "shaftTurns",
      "shaftConflict",
      "humKnown",
      "loudHum",
      "humConflict",
      "overheatingKnown",
      "overheating",
      "overheatingConflict",
      "burningSmellKnown",
      "burningSmell",
      "burningSmellConflict",
      "airflowKnown",
      "lowAirflow",
      "airflowConflict",
      "electricalFault",
      "mechanicalJam",
      "airflowObstruction",
      "urgentStop",
      "inconsistentEvidence",
      "diagnosisUnresolved",
    ),

    Model(
      "diagnosisRules",
      
      ({ electricalFault, motorKnown, motorStarts, breakerKnown, breakerTripped }) =>
        electricalFault ==
        (motorKnown && !motorStarts && breakerKnown && breakerTripped),

      ({ mechanicalJam, motorKnown, motorStarts, shaftKnown, shaftTurns, humKnown, loudHum }) =>
        mechanicalJam ==
        (motorKnown &&
          motorStarts &&
          shaftKnown &&
          !shaftTurns &&
          humKnown &&
          loudHum),

      ({ airflowObstruction, motorKnown, motorStarts, shaftKnown, shaftTurns, airflowKnown, lowAirflow }) =>
        airflowObstruction ==
        (motorKnown &&
          motorStarts &&
          shaftKnown &&
          shaftTurns &&
          airflowKnown &&
          lowAirflow),

      ({ urgentStop, overheatingKnown, overheating, burningSmellKnown, burningSmell }) =>
        urgentStop ==
        ((overheatingKnown && overheating) ||
          (burningSmellKnown && burningSmell)),

      ({ inconsistentEvidence, motorConflict, breakerConflict, shaftConflict, humConflict, overheatingConflict, burningSmellConflict, airflowConflict }) =>
        inconsistentEvidence ==
        (motorConflict ||
          breakerConflict ||
          shaftConflict ||
          humConflict ||
          overheatingConflict ||
          burningSmellConflict ||
          airflowConflict),

      ({ diagnosisUnresolved, inconsistentEvidence, electricalFault, mechanicalJam, airflowObstruction }) =>
        diagnosisUnresolved ==
        (inconsistentEvidence ||
          (!electricalFault && !mechanicalJam && !airflowObstruction)),
    ),
  );
