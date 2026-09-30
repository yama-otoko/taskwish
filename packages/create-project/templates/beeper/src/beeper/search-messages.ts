import { Step } from "taskwish";

import { actor, beeperRequest } from "./beeper";

export const { searchMessages } = actor()
  .on("Command", "searchMessages")

  .input({
    query: "string",
    "limit?": "number",
  })

  .run(
    Step("searchEveryNetwork", function () {
      return beeperRequest("GET", "v1/messages/search", {
        query: { query: this.input.query, limit: this.input.limit ?? 20 },
      });
    }),
  )

  .meta({
    description: "Search message history across every connected Beeper network",
    input: {
      query: { description: "Text to find in messages", example: "launch plan" },
      limit: { description: "Maximum messages to return (up to 20)", example: 20 },
    },
  });
