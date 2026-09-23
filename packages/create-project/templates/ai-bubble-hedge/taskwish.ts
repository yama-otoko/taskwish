import { Console } from "@taskwish/console";
import { Server } from "@taskwish/server";

import { AiBubbleHedge } from "./src/ai-bubble-hedge";
import { HedgeJudge } from "./src/hedge-judge";
import { PaperBroker } from "./src/paper-broker";
import { Polymarket } from "./src/polymarket";

await Server("TaskWish AI Bubble Hedge", {
  port: Number(process.env.PORT ?? 0),
  apps: [Console()],
  workspace: [Polymarket, HedgeJudge, PaperBroker, AiBubbleHedge],
});
