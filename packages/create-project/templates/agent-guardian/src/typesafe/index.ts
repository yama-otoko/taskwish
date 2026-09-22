import { evaluateAgentRun } from "./evaluate-agent-run";
import { actor } from "./typesafe";

export const { TypeSafe } = actor().service({ evaluateAgentRun });
