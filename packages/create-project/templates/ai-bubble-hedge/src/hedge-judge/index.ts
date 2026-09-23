import { evaluateHedgeEvidence } from "./evaluate-hedge-evidence";
import { actor } from "./hedge-judge";

export const { HedgeJudge } = actor().service({ evaluateHedgeEvidence });
