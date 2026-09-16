import { Console } from "@taskwish/console";
import { Server } from "@taskwish/server";

import { BasicAgentLoop } from "./src/basic-agent-loop";
import { Builder } from "./src/builder";
import { DebateLoop } from "./src/debate-loop";
import { EnvironmentLoop } from "./src/environment-loop";
import { EvaluatorOptimizerLoop } from "./src/evaluator-optimizer-loop";
import { EventDrivenLoop } from "./src/event-driven-loop";
import { GoalDrivenLoop } from "./src/goal-driven-loop";
import { GitHub } from "./src/github";
import { HumanInTheLoop } from "./src/human-in-the-loop";
import { MemoryLoop } from "./src/memory-loop";
import { MultiAgentLoop } from "./src/multi-agent-loop";
import { PlanExecuteLoop } from "./src/plan-execute-loop";
import { PlanExecuteReplanLoop } from "./src/plan-execute-replan-loop";
import { ReActLoop } from "./src/react-loop";
import { ReflectionLoop } from "./src/reflection-loop";
import { RetryErrorCorrectionLoop } from "./src/retry-error-correction-loop";
import { SelfAskLoop } from "./src/self-ask-loop";
import { SupervisorWorkerLoop } from "./src/supervisor-worker-loop";
import { ToolCallingLoop } from "./src/tool-calling-loop";
import { TreeSearchLoop } from "./src/tree-search-loop";

await Server("TaskWish Agent Loops", {
  port: Number(process.env.PORT ?? 0),
  apps: [Console()],
  workspace: [
    Builder,
    BasicAgentLoop,
    ReActLoop,
    ToolCallingLoop,
    PlanExecuteLoop,
    PlanExecuteReplanLoop,
    ReflectionLoop,
    EvaluatorOptimizerLoop,
    RetryErrorCorrectionLoop,
    EnvironmentLoop,
    GitHub,
    EventDrivenLoop,
    GoalDrivenLoop,
    MultiAgentLoop,
    SupervisorWorkerLoop,
    DebateLoop,
    SelfAskLoop,
    TreeSearchLoop,
    MemoryLoop,
    HumanInTheLoop,
  ],
});
