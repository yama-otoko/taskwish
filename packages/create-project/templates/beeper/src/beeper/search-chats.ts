import { Step } from "taskwish";

import { actor, beeperRequest } from "./beeper";

export const { searchChats } = actor()
  .on("Command", "searchChats")

  .input({
    query: "string",
    "limit?": "number",
  })

  .run(
    Step("searchEveryNetwork", function () {
      return beeperRequest("GET", "v1/chats/search", {
        query: { query: this.input.query, limit: this.input.limit ?? 20 },
      });
    }),
  )

  .meta({
    description: "Search chats across every connected Beeper network",
    input: {
      query: { description: "Chat title or participant to find", example: "Ada" },
      limit: { description: "Maximum chats to return", example: 20 },
    },
  });
