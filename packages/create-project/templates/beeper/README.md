# TaskWish Beeper

A TaskWish starter for Beeper Desktop's local API. It discovers connected
accounts and every bridge available in the running Beeper installation instead
of hard-coding networks, so the same project works with WhatsApp, Instagram,
Telegram, Google Messages, Google Voice, Google Chat, Messenger, Signal,
LinkedIn, X, Discord, Slack, and future bridges exposed by Beeper.

## Setup

1. Install and run Beeper Desktop.
2. In Beeper Desktop, open **Settings → Integrations → Developer API** and
   create an access token.
3. Copy `.env.example` to `.env` and set `BEEPER_ACCESS_TOKEN`.
4. Run `bun start`, then open the Console URL printed in the terminal.

The API is local by default at `http://127.0.0.1:23373`. Set
`BEEPER_API_URL` only when using Beeper's documented remote-access setup.

## Actions

- `discoverIntegrations` returns server capabilities, connected accounts,
  available bridges, and labels.
- `connectIntegration` starts a login or reconnection session for any bridge.
- `continueIntegrationLogin` submits the next bridge-specific login step.
- `searchChats` and `searchMessages` search across all connected accounts.
- `sendMessage` sends text, replies, or previously uploaded attachments.
- `callBeeperApi` is the forward-compatible escape hatch for every `/v1`
  endpoint: contacts, chat state, drafts, reactions, reminders, labels, assets,
  message edits/deletes, bridge administration, and Beeper app setup.

`callBeeperApi` deliberately accepts only relative `/v1` paths and the five
supported JSON-oriented HTTP methods. Keep the TaskWish API key private: this
action can act with the full authority of the configured Beeper token.

## Examples

Archive a chat through the complete API action:

```json
{
  "method": "PATCH",
  "path": "/v1/chats/CHAT_ID",
  "bodyJson": "{\"isArchived\":true}"
}
```

Add a reaction:

```json
{
  "method": "POST",
  "path": "/v1/chats/CHAT_ID/messages/MESSAGE_ID/reactions",
  "bodyJson": "{\"reactionKey\":\"👍\"}"
}
```

The Beeper Desktop API is intended primarily for personal use. Reading local
history is unrestricted, but high-volume sending can trigger network limits.
