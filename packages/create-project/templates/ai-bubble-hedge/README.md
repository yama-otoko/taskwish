# TaskWish AI bubble hedge

This starter turns Polymarket's **AI bubble burst by...?** market into one
auditable input for a defined-risk, paper-traded put workflow:

```text
Polymarket Gamma API ──▶ JEV evidence judgment ──▶ symbolic risk policy
                                                            │
                           rejected ◀── human approval ──────┤
                                                            ▼
                                                   paper put purchase
```

The default Gamma API slug is
`ai-industry-downturn-by-december-31-2026-857`. Public market data requires no
Polymarket credentials. The JEV step requires `TYPESAFE_API_KEY` and uses
`jev-latest` unless `TYPESAFE_MODEL` is set.

## Run

```sh
cp .env.example .env
# Add TYPESAFE_API_KEY.
bun install
bun start
```

Open the printed Console URL and run
`AiBubbleHedge.evaluateAiBubbleHedge`. Omitting `approvalId` returns
`awaitingApproval`; supplying one allows only the included `PaperBroker` actor
to simulate a long put purchase.

Run local verification without provider credentials:

```sh
bun test
bun run check
```

## Decision boundary

- Polymarket supplies a crowd-priced event probability, not a prediction of a
  specific stock's return.
- JEV assesses relevance, horizon fit, and data quality. It never controls the
  order directly.
- `@taskwish/symbolic` requires the market and JEV thresholds, an active market,
  a reliable data-quality judgment, a strike no higher than spot, and maximum
  premium loss within the configured account-risk budget.
- The example buys a put, so loss is capped at premium paid. It never writes a
  naked option and never connects to a live brokerage.
- A human approval identifier is required after the policy passes.

This is an educational architecture example, not investment advice. Before a
real broker integration, add authenticated quotes, option-chain validation,
market-hours handling, idempotency, durable approvals, audit logs, and a
separately reviewed execution adapter.
