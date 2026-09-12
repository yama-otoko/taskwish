import { Console } from "@taskwish/console";
import { Server } from "@taskwish/server";

import { OpenBanking } from "./src/open-banking";

await Server("TaskWish Open Banking", {
  port: Number(process.env.PORT ?? 0),
  apps: [Console()],
  workspace: [OpenBanking],
});
