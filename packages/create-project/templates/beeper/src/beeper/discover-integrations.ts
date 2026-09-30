import { Step } from "taskwish";

import { actor, beeperRequest } from "./beeper";

export const { discoverIntegrations } = actor()
  .on("Command", "discoverIntegrations")

  .run(
    Step("loadBeeper", async function () {
      const [info, accounts, bridges, labels] = await Promise.all([
        beeperRequest("GET", "v1/info"),
        beeperRequest("GET", "v1/accounts"),
        beeperRequest("GET", "v1/bridges"),
        beeperRequest("GET", "v1/labels"),
      ]);
      return { info, accounts, bridges, labels };
    }),
  )

  .meta({
    description:
      "Discover the running Beeper API, every connected chat account, every available network bridge, and chat labels",
  });
