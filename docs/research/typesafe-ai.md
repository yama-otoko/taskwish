# TypeSafe.ai integration research

Research date: 2026-09-22

## Recommendation

Use TypeSafe.ai as a machine-decision layer inside TaskWish workflows, not as a
replacement for TaskWish's generative AI providers. The strongest first use
case is **agent-run governance**: evaluate a completed conversation and its tool
trace, then let deterministic code auto-close healthy runs or route risky and
uncertain runs to people.

This pairing is unusually direct:

- TaskWish supplies typed actors, observable steps, tool calls, events, and
  deterministic orchestration.
- TypeSafe System One supplies bounded `noul`, `choice`, and `score` judgments
  with probabilities or confidence.
- Application code owns the action thresholds and side effects.

The resulting boundary is `TypeSafe.evaluateAgentRun`. The provider-specific
HTTP contract stays behind that actor; `AgentGuardian.reviewAgentRun` consumes
domain-shaped judgments and owns policy.

## API findings

The public OpenAPI 3.1 schema is version 0.2.0 and exposes:

- `POST /v1/systemone` with bearer authentication.
- `GET /v1/models` to discover model names and aliases.
- A request containing `state`, `model`, and a named `questions` map.
- Three question types: `noul` (yes/no probability), `choice` (selected option,
  distribution, confidence), and `score` (expected score, distribution,
  confidence).
- A response containing answers under the same names, the resolved model, and
  input/output token usage.

TypeSafe recommends sending questions that share state in one request. The
questions are independently evaluated, so speculative questions can be batched
and ignored later in code. Dependent questions require a later request only
when an earlier answer changes what evidence or choices are available.

## Candidate use cases

| Use case | Fit | Reason |
| --- | --- | --- |
| Agent-run governance | Best | Native match for TaskWish traces; confidence maps cleanly to auto-close/review/page policy; showcases both products without another external system. |
| Customer-support routing | Strong | High volume and narrow decisions, but overlaps common vendor demos and needs CRM/billing integrations for a credible end-to-end template. |
| Invoice approval | Strong | Excellent mix of deterministic arithmetic and judgment, but document extraction, procurement, and payment integrations make the first template much larger. |
| Security alert triage | Strong but risky | Clear typed decisions and escalation, but a starter could imply unsafe autonomous containment without a mature authorization layer. |
| Free-form content generation | Poor | TypeSafe returns decisions rather than prose; TaskWish's existing AI provider abstraction already serves generation. |

## Design decisions

1. Expose the official TypeSafe JavaScript client through a reusable
   `TypeSafe("stepName", options)` primitive in `@taskwish/ai`, with TaskWish-style
   `ModelNoul`, `ModelChoice`, and `ModelScore` builders. This preserves inferred
   answer types while keeping provider plumbing out of individual templates.
2. Adapt provider output through a `TypeSafe` actor. This follows TaskWish's
   service boundary and prevents vendor field names from spreading into the
   routing workflow.
3. Batch all five independent judgments in one request. This matches TypeSafe's
   parallel-question model and avoids one-call-per-question latency.
4. Keep thresholds and routing in `AgentGuardian`. Model output is evidence,
   not authorization.
5. Fail closed. Missing credentials, malformed responses, uncertainty, and
   possible permission breaches never auto-close.
6. Return routes instead of performing side effects. Paging or ticket creation
   should be a separately authorized actor added by the adopting application.

## Sources

- TypeSafe home and product model: https://typesafe.ai/
- API documentation and OpenAPI schema: https://api.typesafe.ai/docs and
  https://api.typesafe.ai/openapi.json
- TypeSafe primitives and batching guidance: https://docs.typesafe.ai/
- Workflow evaluation methodology: https://evals.typesafe.ai/
- Agent trace observability example: https://evals.typesafe.ai/agent_trace_observability
- Privacy policy: https://typesafe.ai/legal/privacy-policy
