import { Input, Step } from "taskwish";

import { actor } from "./agent-guardian";

const PERMISSION_PAGE_THRESHOLD = 0.85;
const PERMISSION_REVIEW_THRESHOLD = 0.2;
const MIN_CONFIDENCE = 0.6;

export const { reviewAgentRun } = actor()
  .on("Command", "reviewAgentRun")

  .input({
    runId: "string",
    agentInstructions: "string",
    conversation: Input.List({
      role: "'user' | 'assistant' | 'system'",
      content: "string",
    }),
    toolCalls: Input.List({
      name: "string",
      arguments: "string",
      result: "string",
      reversible: "boolean",
    }),
    finalMessage: "string",
    "feedback?": "string",
  })

  .run(
    Step("evaluateRun", function () {
      return this.actions.typeSafe.evaluateAgentRun(this.input);
    }),

    Step("routeReview", function () {
      const evaluation = this.evaluateRun;
      const hasIrreversibleAction = this.input.toolCalls.some(
        (call) => !call.reversible,
      );
      const breachProbability = hasIrreversibleAction
        ? evaluation.permissionBreach.noul
        : 0;
      const confidence = Math.min(
        hasIrreversibleAction
          ? binaryConfidence(evaluation.permissionBreach.noul)
          : 1,
        binaryConfidence(evaluation.taskComplete.noul),
        binaryConfidence(evaluation.userSatisfied.noul),
        evaluation.failureMode.confidence,
        evaluation.reviewUrgency.confidence,
      );

      if (breachProbability >= PERMISSION_PAGE_THRESHOLD) {
        return decision("PAGE_ON_CALL", "probable permission breach", confidence);
      }
      if (
        breachProbability >= PERMISSION_REVIEW_THRESHOLD ||
        evaluation.reviewUrgency.score >= 2.5
      ) {
        return decision(
          "PRIORITY_REVIEW",
          "possible permission breach or high operational impact",
          confidence,
        );
      }
      if (confidence < MIN_CONFIDENCE) {
        return decision(
          "HUMAN_REVIEW",
          "model confidence is below the automation threshold",
          confidence,
        );
      }
      if (evaluation.failureMode.choice === "silent_failure") {
        return decision("FILE_ISSUE", "probable silent failure", confidence);
      }
      if (
        evaluation.taskComplete.noul < 0.5 ||
        evaluation.userSatisfied.noul < 0.5 ||
        evaluation.failureMode.choice !== "healthy"
      ) {
        return decision(
          "HUMAN_REVIEW",
          "incomplete, unsatisfactory, or unhealthy run",
          confidence,
        );
      }
      return decision("AUTO_CLOSE", "healthy completed run", confidence);
    }),

    Step("review", function () {
      return {
        runId: this.evaluateRun.runId,
        route: this.routeReview.route,
        reason: this.routeReview.reason,
        confidence: this.routeReview.confidence,
        evaluation: this.evaluateRun,
      };
    }),
  )

  .meta({
    description:
      "Review a completed agent run and route it with deterministic confidence thresholds",
    input: {
      runId: {
        description: "Stable identifier from the agent runtime",
        example: "run_01J9YQ6K8Q3P7M2C",
      },
      agentInstructions: {
        description: "Instructions and permission boundaries active for the run",
        example: "Draft refunds, but never issue one without user approval.",
      },
      conversation: {
        description: "Ordered conversation messages with secrets redacted",
      },
      toolCalls: {
        description: "Ordered tool calls with arguments, results, and reversibility",
      },
      finalMessage: {
        description: "The agent's final user-facing response",
        example: "Your refund has been issued.",
      },
      feedback: {
        description: "Optional explicit user rating or comment",
        example: "I never approved that refund.",
      },
    },
  });

function binaryConfidence(probability: number): number {
  return Math.abs(probability - 0.5) * 2;
}

function decision(
  route:
    | "AUTO_CLOSE"
    | "HUMAN_REVIEW"
    | "PRIORITY_REVIEW"
    | "FILE_ISSUE"
    | "PAGE_ON_CALL",
  reason: string,
  confidence: number,
) {
  return { route, reason, confidence };
}
