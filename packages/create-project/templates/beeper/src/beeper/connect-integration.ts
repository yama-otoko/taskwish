import { Step } from "taskwish";

import { actor, beeperRequest, encodePathSegment } from "./beeper";

export const { connectIntegration } = actor()
  .on("Command", "connectIntegration")

  .input({
    bridgeId: "string",
    "flowId?": "string",
    "accountId?": "string",
    "loginId?": "string",
  })

  .run(
    Step("startLoginSession", function () {
      const { bridgeId, flowId, accountId, loginId } = this.input;
      return beeperRequest(
        "POST",
        `v1/bridges/${encodePathSegment(bridgeId)}/login-sessions`,
        {
          body: {
            ...(flowId ? { flowID: flowId } : {}),
            ...(accountId ? { accountID: accountId } : {}),
            ...(loginId ? { loginID: loginId } : {}),
          },
        },
      );
    }),
  )

  .meta({
    description:
      "Start a connection or reconnection flow for any bridge returned by discoverIntegrations",
    input: {
      bridgeId: { description: "Bridge ID", example: "local-whatsapp" },
      flowId: { description: "Optional bridge login flow ID" },
      accountId: { description: "Existing account ID when reconnecting" },
      loginId: { description: "Existing bridge login ID when reconnecting" },
    },
  });
