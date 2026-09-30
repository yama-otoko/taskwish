import { Step } from "taskwish";

import { actor, beeperRequest, encodePathSegment } from "./beeper";

export const { sendMessage } = actor()
  .on("Command", "sendMessage")

  .input({
    chatId: "string",
    "text?": "string",
    "replyToMessageId?": "string",
    "uploadId?": "string",
    "fileName?": "string",
    "mimeType?": "string",
  })

  .run(
    Step("validateMessage", function () {
      if (!this.input.text?.trim() && !this.input.uploadId?.trim()) {
        throw new Error("Provide text or uploadId.");
      }
      return this.input;
    }),

    Step("postMessage", function () {
      const { chatId, text, replyToMessageId, uploadId, fileName, mimeType } = this.validateMessage;
      return beeperRequest(
        "POST",
        `v1/chats/${encodePathSegment(chatId)}/messages`,
        {
          body: {
            ...(text ? { text } : {}),
            ...(replyToMessageId ? { replyToMessageID: replyToMessageId } : {}),
            ...(uploadId
              ? {
                  attachment: {
                    uploadID: uploadId,
                    ...(fileName ? { fileName } : {}),
                    ...(mimeType ? { mimeType } : {}),
                  },
                }
              : {}),
          },
        },
      );
    }),
  )

  .meta({
    description: "Send text, replies, or an uploaded attachment to a chat on any Beeper network",
    input: {
      chatId: { description: "Beeper chat ID or local chat ID", example: "chat-id" },
      text: { description: "Plain text or Markdown message" },
      replyToMessageId: { description: "Message ID to reply to" },
      uploadId: { description: "Upload ID returned by the Beeper assets API" },
    },
  });
