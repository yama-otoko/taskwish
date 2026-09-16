import { Console } from "@taskwish/console";
import { Server } from "@taskwish/server";

import { Builder } from "./src/builder";
import { OptionsAnalyst } from "./src/options-analyst";

await Server("TaskWish Options Analyst", {
  port: Number(process.env.PORT ?? 0),
  apps: [Console()],
  workspace: [Builder, OptionsAnalyst],
});
