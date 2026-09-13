# TaskWish revenue monitor

A real-world workflow that combines deterministic symbolic reasoning with two
external integrations:

```text
GoCardless Bank Account Data ──▶ OpenBanking.getAccountRevenue
                                            │
                                            ▼
                             RevenueMonitor.revenueMonitor
                                  │                     │
                                  │ on target           │ below target
                                  ▼                     ▼
                              return report      Slack.postMessage
```

On its monthly schedule, `RevenueMonitor` totals positive booked transactions
from the previous complete calendar month, solves the symbolic growth model
`y = t / 2 + sin(t)`, compares actual revenue with that target, and posts a
Slack alert only when the account is behind. Revenue values returned by the bank
API are converted to thousands before comparison.

The symbolic backend treats declared functions as uninterpreted, so the model
constrains `sin(t)` with a seventh-order Taylor approximation. Keep `time`
between `-2` and `2`, where that approximation is useful, or replace the curve
with your production forecast.

## Run

Create GoCardless Bank Account Data user secrets and a Slack bot token, then:

```sh
cp .env.example .env
# Fill in GOCARDLESS_BANK_SECRET_ID, GOCARDLESS_BANK_SECRET_KEY,
# TW_SLACK_API_KEY, and SLACK_CHANNEL_ID.
bun install
bun start
```

The server registers `RevenueMonitor.revenueMonitor` as a real cron
job. It runs at 09:00 UTC on the first day of each month by default and checks
the preceding calendar month. Edit the action's cron expression to use another
schedule and set `TZ` to choose the server timezone. Overlapping executions are
prevented by default.

Runtime configuration comes from the environment:

```sh
REVENUE_MONITOR_ACCOUNT_ID=2f1dd34e-5b82-4f8f-a88c-06e927da1746
REVENUE_MONITOR_TIME=1
SLACK_CHANNEL_ID=C0123456789
```

Use GoCardless's requisition flow or the TaskWish `open-banking` starter to
link an account and obtain its account ID. This starter reads account
information only; it does not initiate payments.

Run local verification without credentials:

```sh
bun test
bun run check
```

## Production notes

- Replace the illustrative curve with a model fitted to your business and
  explicitly define its units, seasonality, and valid time domain.
- Decide whether refunds should reduce revenue. This starter totals positive
  booked transactions and excludes debits.
- Store provider credentials and financial data server-side. Add
  authentication, authorization, encrypted persistence, retention/deletion
  controls, audit logs, and explicit consent records.
- Account access expires, bank data can arrive late, and provider rate limits
  apply. Persist snapshots and schedule retries before relying on alerts.
- Use Slack channel IDs rather than names and grant the bot only the scopes it
  needs.
