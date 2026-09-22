# TaskWish agent guardian

A real-world TypeSafe.ai integration that reviews completed AI-agent runs and
routes the exceptions:

```text
agent trace ──▶ TypeSafe.evaluateAgentRun ──▶ calibrated typed judgments
                                                        │
                                                        ▼
                                          AgentGuardian.reviewAgentRun
                                                        │
                     AUTO_CLOSE · HUMAN_REVIEW · PRIORITY_REVIEW
                              FILE_ISSUE · PAGE_ON_CALL
```

The TypeSafe actor is the provider adapter. It sends the trace once and asks
five independent System One questions in parallel: permission breach, task
completion, user satisfaction, failure mode, and review urgency. It validates
the provider response before returning domain-shaped data.

The AgentGuardian actor owns policy. Ordinary TypeScript checks whether a tool
call was irreversible, applies probability and confidence thresholds, and
chooses a route. TypeSafe makes judgments; code retains control over actions.

## Run

Create a TypeSafe API key, then:

```sh
cp .env.example .env
# Fill in TYPESAFE_API_KEY.
bun install
bun start
```

Open the printed Console URL and run `AgentGuardian.reviewAgentRun`. The action
is also available through TaskWish's HTTP and MCP surfaces.

Run local verification without provider credentials:

```sh
bun test
bun run check
```

## Integration boundary

TaskWish AI exposes a `TypeSafe("stepName", options)` workflow step and typed
`ModelNoul`, `ModelChoice`, and `ModelScore` question builders. The `TypeSafe`
actor turns that provider contract into the stable
`evaluateAgentRun` domain action. If TypeSafe changes its API, update the
TaskWish AI dependency and keep the guardian policy unchanged.

The example uses `jev-latest`; set `TYPESAFE_MODEL` to another model returned by
`GET /v1/models`. Use `TYPESAFE_BASE_URL` only for a trusted proxy or test
server.

## Production notes

- Redact passwords, tokens, payment details, health data, and unrelated PII
  before sending traces. Treat tool arguments and results as sensitive.
- Derive `reversible` from a reviewed tool registry, not from the agent's own
  claim. Default unknown tools to irreversible.
- Tune thresholds against labeled runs from your own policy and track false
  positives and false negatives. The included values are safe examples, not a
  universal compliance policy.
- Keep irreversible response actions behind separate authorization. This
  template only returns a route; it does not page, close, or mutate external
  systems.
- Add authenticated ingestion, tenant isolation, encrypted storage, retention
  limits, audit logs, rate limiting, retries, and idempotency before production.
- Pin a dated model after evaluation if changes to the `jev-latest` alias would
  be operationally risky.
