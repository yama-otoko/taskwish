import { Console } from "@taskwish/console";
import { Server } from "@taskwish/server";

import { Builder } from "./src/builder";
import { Documents } from "./src/documents";
import { Emails } from "./src/emails";
import { FreightOperator } from "./src/freight-operator";
import { Gmail } from "./src/gmail";
import { LoadExtractor } from "./src/load-extractor";

await Server("TaskWish Freight Operator", {
  port: Number(process.env.PORT ?? 0),
  apiKey: process.env.TW_API_KEY || undefined,
  mcp: false,
  apps: [Console()],
  workspace: [Builder, Documents, Emails, Gmail, LoadExtractor, FreightOperator],
});
