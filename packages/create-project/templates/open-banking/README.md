# TaskWish Open Banking

A European open-banking starter built on the GoCardless Bank Account Data API.
It demonstrates the PSD2 Account Information flow while keeping API secrets
out of the browser and source code:

1. List supported banks for an EEA country.
2. Create a requisition and send the user to the bank-hosted consent flow.
3. Use the requisition ID after redirect to retrieve accounts, balances, and
   booked and pending transactions.

This is an account-information (read-only) starter. It does not initiate
payments.

## Run

Create Bank Account Data user secrets in the GoCardless portal, then:

```sh
cp .env.example .env
# Add GOCARDLESS_BANK_SECRET_ID and GOCARDLESS_BANK_SECRET_KEY to .env
bun install
bun start
```

Open the Console URL and run these commands in order:

- `OpenBanking.listBanks` with a two-letter country such as `DE`.
- `OpenBanking.startBankConnection` with the selected institution ID. For a
  test connection, use `SANDBOXFINANCE_SFIN0000` and a localhost redirect URL.
- Open the returned `link` in a browser and complete consent.
- `OpenBanking.syncBankConnection` with the returned requisition `id`.

Run verification with:

```sh
bun test
bun run check
```

## Production notes

- Bank availability varies by country and provider. PSD2 does not define one
  universal API shared by every European bank.
- Keep secrets and returned account data on the server. Add authentication,
  authorization, encrypted storage, retention/deletion controls, audit logs,
  and explicit consent records before handling real customer data.
- Account access expires and must be renewed. Banks can impose strict rate
  limits, so persist snapshots and sync on a controlled schedule.
- Confirm your regulatory role and provider agreement before production use.
  GoCardless operates the AISP connection for its supported EEA coverage, but
  that does not remove your own GDPR, security, and contractual obligations.

References: [GoCardless Bank Account Data overview](https://docs.gocardless.com/docs/bank-account-data),
[quickstart](https://docs.gocardless.com/docs/bank-account-data/quickstart-guide),
and [API endpoints](https://docs.gocardless.com/docs/bank-account-data/endpoints).
