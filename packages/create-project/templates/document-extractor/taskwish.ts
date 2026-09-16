import { Console } from "@taskwish/console";
import { Server } from "@taskwish/server";

import { Builder } from "./src/builder";
import { Documents } from "./src/documents";

await Server("TaskWish Document Extractor", {
  port: Number(process.env.PORT ?? 0),
  apiKey: process.env.TW_API_KEY || undefined,
  mcp: false,
  apps: [Console()],
  workspace: [Builder, Documents],
});
