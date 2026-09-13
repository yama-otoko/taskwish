# TaskWish freight operator

A runnable freight intake and approval template using [Firecrawl Anydoc](https://github.com/firecrawl/anydoc), [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), and [McLeod Order Creation](https://innovationhub.mcleodsoftware.com/OrderCreationDocs) for PowerBroker.

```text
Email / documents
    │
    ▼
Anydoc → Markdown → OpenAI → Extract Load
                                │
                                ▼
                             Validate
                                │
                   corrections ◄┤
                                ▼
                         Human Approval
                                │
                                ▼
                       McLeod PowerBroker
                                │
                       check request status
                                │
                                ▼
                          Order Created
```

The Console exposes intake, source text, extracted fields, validation issues,
correction, approval/rejection, and order status. The extractor has no tools and
never approves a load. Only `FreightOperator.reviewLoad` submits an order request,
after a human approves the current revision and deterministic validation passes.
The `Emails` actor converts decoded email bodies to Markdown, while `Documents`
owns document conversion through Anydoc. The `Gmail` actor reads message bodies
and attachments from the Gmail API.

## Run

Generate this template with the create-project CLI:

```sh
bunx @taskwish/create-project my-freight-app --template freight-operator --yes
cd my-freight-app
cp .env.example .env
# Set TW_OPEN_AI_KEY and the McLeod configuration in .env.
bun start
```

Inside this repository, run `bun install` and `bun start` from this template
directory. Use the Console URL and operator API key printed at startup. Bun
loads `.env`; for Node.js 20+, use `npm install`, export the environment variables,
then run `npm run start:node`. The example uses the typed `openai/gpt-6-astra`
model identifier.

The server starts without external credentials. Extraction requires OpenAI
credentials; approval requires McLeod credentials. Tests need neither:

```sh
bun run check
bun test
```

## Intake and review

`receiveLoad` accepts decoded email text, document attachments, or both. A mailbox
adapter (Microsoft Graph, Gmail, IMAP, or an inbound-email provider) should decode
MIME, preserve the Message-ID as `sourceId`, and post this normalized JSON.
The template does not poll a mailbox or parse raw `.eml` files.

To fetch directly from Gmail, set `GMAIL_ACCESS_TOKEN` to an OAuth 2.0 token with
the `gmail.readonly` scope, then provide the immutable Gmail message ID:

```json
{
  "sourceId": "gmail-message-1042",
  "customerId": "1CHC",
  "gmailMessageId": "18f123456789abcd",
  "gmailUserId": "me"
}
```

`Gmail.getGmailMessage` calls `users.messages.get` with the full format, walks
the MIME parts, and downloads attachment bodies through
`users.messages.attachments.get`. Replace the environment token with your OAuth
token refresh flow for a deployed service.

Use the included `examples/email-load.json` with the Console or authenticated API:

```sh
curl -X POST "http://localhost:YOUR_PORT/tw/FreightOperator/receive-load" \
  -H "Authorization: Bearer YOUR_OPERATOR_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @examples/email-load.json
```

Supply `customerId` from verified intake configuration: a McLeod bill-to master
ID or a configured CustomerFusion cross-reference. OpenAI never chooses the
customer ID. Document-only intake uses the same command:

```json
{
  "sourceId": "document-1042",
  "customerId": "1CHC",
  "attachments": [
    { "name": "tender.pdf", "contentBase64": "RAW_BASE64_DOCUMENT_BYTES" }
  ]
}
```

| Action | What to do |
| --- | --- |
| `receiveLoad` | Extract one load from email/documents and stop at review. Repeated source IDs return the existing record; failed extraction can be retried with identical input. |
| `listLoads` | Inspect the source Markdown, complete load, issues, `id`, `revision`, and audit trail. Optionally filter by `status`. |
| `reviseLoad` | Supply the complete corrected `load`, current `revision`, reviewer, and correction note. The revision increments and validation runs again. |
| `reviewLoad` | Supply `id`, current `revision`, `decision: "approve"` or `"reject"`, reviewer, and note. Approval submits exactly the reviewed draft. |
| `refreshOrder` | Retrieve McLeod status until an order ID exists. No second POST is sent. |

Review both the source and draft, including customer ID, BOL, equipment codes,
hazmat status, rate, locations, and stop timezone offsets. Unknown fields stay
`null`; missing or conflicting values block approval. Resolve each extraction
concern explicitly and describe its resolution in the correction note.

Example approval input, using values returned by `listLoads`:

```json
{
  "id": "LOAD_ID_FROM_INTAKE",
  "revision": 1,
  "reviewer": "dispatch@example.com",
  "decision": "approve",
  "note": "Verified source, bill-to mapping, rate, equipment, and stop time zones."
}
```

This initial mapping supports a flat USD linehaul rate, pounds, piece counts,
hazmat/UN information, temperature ranges in Fahrenheit, and multiple stops.
Accessorial charges and requirements outside the schema are raised as concerns;
extend the schema, validator, and McLeod mapper before accepting those loads.
Do not clear a concern merely to bypass an unsupported requirement.

## McLeod configuration

The adapter implements `POST /customers/{customerId}/order-requests` and
`GET /customers/{customerId}/order-requests/{orderRequestId}` from McLeod's
[official OpenAPI contract](https://innovationhub-assets.mcleodsoftware.com/server-ordercreation.yaml).
This API requires **CustomerFusion** and Order Creation entitlement for the
PowerBroker tenant. It is separate from McLeod's direct-hosted `/ws` API.

| Variable | Purpose |
| --- | --- |
| `MCLEOD_BASE_URL` | Defaults to `https://api.mcleodsoftware.com/ordercreation-sandbox`; use the live `/ordercreation` URL when configured for production. |
| `MCLEOD_AUTHORIZATION` | Complete Authorization header value issued through McLeod access setup. |
| `MCLEOD_API_KEY` | Innovation Hub product API key, sent as `X-Api-Key`. |
| `MCLEOD_TENANT` | Tenant identifier, sent as `X-Mcld-Tenant`. |
| `MCLEOD_FUSION_PROFILE` | Optional `X-Mcld-Fusion-Profile` value. |

Configure customer, location, equipment, and other required cross-references in
CustomerFusion/PowerBroker. Tenant-specific revenue/allocation/order codes can
be added in `src/shared/powerbroker.ts`. Token acquisition and refresh belong in
your deployment's credential management; this starter reads configured values.

An HTTP success or `Accepted` status alone does not finish the workflow.
`requestId` is recorded and the load stays `awaitingOrder` until
`status.orderId` is returned. Then the actor emits `FreightOperator::OrderCreated`.
`Declined` becomes `orderDeclined`; `PendingInput` and `Conditional` remain pending
for resolution in McLeod and another `refreshOrder` call.

## Recovery and operating boundaries

State persists in `state/` (override with `TW_DEFAULT_STORE_PATH`). Retain this
directory across restarts. Run one server process per store: in-process locks
and persisted submission markers prevent overlapping approvals and repeated
submissions. Scale-out requires a transactional store with distributed locking
and unique customer/BOL constraints.

The adapter sends the load ID as `X-Correlation-Id`. McLeod does not document this
as an idempotency key. A failed/timed-out POST becomes `submissionUnknown`, and a
process interrupted during submission leaves `submitting`. Neither state can
be approved again. Find the request in McLeod by correlation ID and BOL; then
call `refreshOrder` with its `requestId`, reviewer, and a reconciliation note.
If no request was created, investigate and resolve the record operationally
before allowing another submission. There is deliberately no blind retry/reset
command for uncertain writes. Local duplicate detection does not search orders
created by other systems.

The default Console API key is an **operator credential**. `reviewer` is an audit
label, not authenticated identity. For unattended email intake, put an
authenticated gateway in front that allows the mailbox service to call only
`receiveLoad`, and restrict review/revision/reconciliation to human operators.
Bind reviewer identity to your identity provider there. MCP is disabled in this
starter; the OpenAI extraction call receives no tools.

Source text and audit records are retained locally and appear in Console and
TaskWish traces. OpenAI receives the combined Markdown with `store: false`.
Anydoc converts supported documents locally. Set `ANYDOC_OCR=hosted` to opt into sending
scanned PDFs to Firecrawl Parse; `FIRECRAWL_API_KEY` is optional. Without OCR,
unreadable PDFs fail intake rather than silently dropping attachments.

Tests cover real local PDF and CSV conversion, malformed inputs, strict extraction,
validation, review revisions, rejection, concurrent and duplicate submission,
pending/created states, and reconciliation. OpenAI and McLeod are mocked;
validate a sandbox order with your tenant's credentials and mappings before
live use.
