import { Console } from "@taskwish/console";
import { Server } from "@taskwish/server";

import { Builder } from "./src/builder";
import { Greeter } from "./src/greeter";

await Server("TaskWish Greeter", {
  apps: [Console()],
  workspace: [Builder, Greeter],
});
