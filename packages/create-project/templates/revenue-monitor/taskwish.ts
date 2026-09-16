import { Console } from "@taskwish/console";
import { Server } from "@taskwish/server";

import { Builder } from "./src/builder";
import { OpenBanking } from "./src/open-banking";
import { RevenueMonitor } from "./src/revenue-monitor";
import { Slack } from "./src/slack";

await Server("TaskWish Revenue Monitor", {
  port: Number(process.env.PORT ?? 0),
  apps: [Console()],
  workspace: [Builder, OpenBanking, Slack, RevenueMonitor],
});
