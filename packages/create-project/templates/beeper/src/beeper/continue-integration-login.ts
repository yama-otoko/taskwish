import { Step } from "taskwish";

import {
  actor,
  beeperRequest,
  encodePathSegment,
  parseJsonObject,
} from "./beeper";

export const { continueIntegrationLogin } = actor()
  .on("Command", "continueIntegrationLogin")

  .input({
    bridgeId: "string",
    loginSessionId: "string",
    stepId: "string",
    type: "string",
    "fieldsJson?": "string",
    "lastUrl?": "string",
    "source?": "string",
  })

  .run(
    Step("submitLoginStep", function () {
      const { bridgeId, loginSessionId, stepId, type, fieldsJson, lastUrl, source } = this.input;
      if (!["user_input", "cookies", "display_and_wait"].includes(type)) {
        throw new Error("type must be user_input, cookies, or display_and_wait.");
      }
      return beeperRequest(
        "POST",
        `v1/bridges/${encodePathSegment(bridgeId)}/login-sessions/${encodePathSegment(loginSessionId)}/steps/${encodePathSegment(stepId)}`,
        {
          body: {
            type,
            ...(fieldsJson ? { fields: parseJsonObject(fieldsJson, "fieldsJson") } : {}),
            ...(lastUrl ? { lastURL: lastUrl } : {}),
            ...(source ? { source } : {}),
          },
        },
      );
    }),
  )

  .meta({
    description: "Submit the next prompt, cookie, or display step for any Beeper network login",
    input: {
      bridgeId: { description: "Bridge ID", example: "local-whatsapp" },
      loginSessionId: { description: "Login session returned by connectIntegration" },
      stepId: { description: "Current step ID returned by Beeper" },
      type: { description: "user_input, cookies, or display_and_wait", example: "user_input" },
      fieldsJson: { description: "JSON object keyed by Beeper's requested field IDs", example: "{\"phone\":\"+15550101002\"}" },
    },
  });
