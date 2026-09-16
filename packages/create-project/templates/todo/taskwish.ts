import { Console } from "@taskwish/console";
import { Server } from "@taskwish/server";

import { Builder } from "./src/builder";
import { Todos } from "./src/todos";

await Server("TaskWish Todo", {
  apps: [Console()],
  workspace: [Builder, Todos],
});
