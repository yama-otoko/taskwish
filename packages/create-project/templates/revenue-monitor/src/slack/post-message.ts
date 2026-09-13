import { Step } from "taskwish";

import { actor } from "./slack";

type SlackMessageResponse = {
  ok: boolean;
  channel?: string;
  ts?: string;
  error?: string;
};

export const { postMessage } = actor()
  .on("Command", "postMessage")

  .input({
    channel: "string",
    text: "string",
  })

  .run(
    Step("sendMessage", async function (): Promise<SlackMessageResponse> {
      const token = process.env.TW_SLACK_API_KEY?.trim();
      if (!token) {
        throw new Error("TW_SLACK_API_KEY is required to post to Slack.");
      }

      const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(this.input),
      });
      const result = (await response.json()) as SlackMessageResponse;
      if (!response.ok || !result.ok) {
        throw new Error(
          `Slack message failed: ${result.error ?? response.statusText}`,
        );
      }
      return result;
    }),
  )

  .meta({
    description: "Post a revenue alert to a Slack channel",
    input: {
      channel: { description: "Slack channel ID", example: "C0123456789" },
      text: { description: "Alert text", example: "Revenue is below target" },
    },
  });
