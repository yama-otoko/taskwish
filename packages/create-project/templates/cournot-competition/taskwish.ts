import { Console } from "@taskwish/console";
import { Server } from "@taskwish/server";

import { CournotCompetition } from "./src/cournot-competition";

await Server("Cournot Competition", {
  port: Number(process.env.PORT ?? 0),
  apps: [Console()],
  workspace: [CournotCompetition],
});
