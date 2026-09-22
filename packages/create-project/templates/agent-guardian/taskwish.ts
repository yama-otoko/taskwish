import { Console } from "@taskwish/console";
import { Server } from "@taskwish/server";

import { AgentGuardian } from "./src/agent-guardian";
import { TypeSafe } from "./src/typesafe";

await Server("TaskWish Agent Guardian", {
  port: Number(process.env.PORT ?? 0),
  apps: [Console()],
  workspace: [TypeSafe, AgentGuardian],
});
