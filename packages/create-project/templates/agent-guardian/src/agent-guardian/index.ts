import { actor } from "./agent-guardian";
import { reviewAgentRun } from "./review-agent-run";

export const { AgentGuardian } = actor().service({ reviewAgentRun });
