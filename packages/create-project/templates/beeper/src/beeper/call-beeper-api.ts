import { Step } from "taskwish";

import {
  actor,
  beeperRequest,
  parseJsonObject,
  type BeeperMethod,
} from "./beeper";

export const { callBeeperApi } = actor()
  .on("Command", "callBeeperApi")

  .input({
    method: "string",
    path: "string",
    "queryJson?": "string",
    "bodyJson?": "string",
  })

  .run(
    Step("validateRequest", function () {
      const method = this.input.method.trim().toUpperCase();
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        throw new Error("method must be GET, POST, PUT, PATCH, or DELETE.");
      }
      const query = parseJsonObject(this.input.queryJson, "queryJson");
      const body = this.input.bodyJson === undefined
        ? undefined
        : parseJsonObject(this.input.bodyJson, "bodyJson");
      return { method: method as BeeperMethod, query, body };
    }),

    Step("requestBeeper", function () {
      const query = Object.fromEntries(
        Object.entries(this.validateRequest.query).map(([key, value]) => {
          if (!["string", "number", "boolean"].includes(typeof value)) {
            throw new Error(`queryJson value for ${key} must be a string, number, or boolean.`);
          }
          return [key, value as string | number | boolean];
        }),
      );
      return beeperRequest(this.validateRequest.method, this.input.path, {
        query,
        body: this.validateRequest.body,
      });
    }),
  )

  .meta({
    description:
      "Call any endpoint in Beeper's versioned /v1 Desktop API, including chats, contacts, messages, reactions, reminders, assets, labels, bridge logins, and app setup",
    input: {
      method: { description: "HTTP method", example: "PATCH" },
      path: { description: "Path inside /v1; external URLs are rejected", example: "/v1/chats/chat-id" },
      queryJson: { description: "Optional flat JSON object of query parameters", example: "{\"limit\":20}" },
      bodyJson: { description: "Optional JSON object request body", example: "{\"isArchived\":true}" },
    },
  });
