import { Console } from "@taskwish/console";
import { Server } from "@taskwish/server";

import { Builder } from "./src/builder";
import { EquipmentDiagnostician } from "./src/equipment-diagnostician";

await Server("TaskWish Equipment Diagnostician", {
  port: Number(process.env.PORT ?? 0),
  apps: [Console()],
  workspace: [Builder, EquipmentDiagnostician],
});
