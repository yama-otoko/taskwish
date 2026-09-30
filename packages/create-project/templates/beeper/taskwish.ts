import { Console } from "@taskwish/console";
import { Server } from "@taskwish/server";

import { Beeper } from "./src/beeper";
import { Builder } from "./src/builder";

await Server("TaskWish Beeper", {
  port: Number(process.env.PORT ?? 0),
  apps: [Console()],
  workspace: [Builder, Beeper],
});
