import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { type as arkType } from "arktype";
import { ToCEL } from "@taskwish/expr";
import type {
  ConsoleAction,
  ConsoleConfig,
  ConsoleJsonSchema,
  ConsoleInputField,
} from "./types";
import { sentenceFromIdentifier } from "./lib/console-text";

const TW_META = Symbol.for("TW.Meta");
const TW_INPUT_SCHEMA = Symbol.for("TW.InputSchema");
const HTTP_ROUTE_METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH"]);
const PRIMITIVE_ARK_SCHEMAS = new Set([
  "string",
  "number",
  "boolean",
  "bigint",
  "symbol",
  "object",
  "unknown",
]);

type Action = (...args: unknown[]) => unknown;
type McpConfig = boolean;
type NodeRegistry = {
  actions: Map<string, Action>;
  states?: Map<string, Record<string, unknown>>;
};
type NodeRouteHandler = (request: Request) => Response | Promise<Response>;
type NodeRoutes = Record<
  string,
  Partial<Record<string, NodeRouteHandler>> | Response
>;
type NodeAppContext = {
  registry: NodeRegistry;
  nodeName: string;
  apiKey: string;
  prefix: string;
  mcp?: McpConfig;
};
type NodeAppReadyContext = NodeAppContext & {
  server: { url: URL };
};

export type ConsoleApp = {
  name?: string;
  routes?: (context: NodeAppContext) => NodeRoutes | Promise<NodeRoutes>;
  ready?: (context: NodeAppReadyContext) => void | Promise<void>;
};

export type ConsoleOptions = {
  openBrowser?: boolean | "ask";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const DEFAULT_MCP_PATH = "/actor";

function mcpToolName(actionName: string): string {
  return actionName
    .replace(/::/g, ".")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, 128);
}

function mcpToolDescription(actionName: string, action: Action): string {
  const meta = metaForAction(action);
  if (typeof meta.description === "string") return meta.description;

  const route = meta.route;
  if (Array.isArray(route) && isRecord(route[2])) {
    const description = route[2].description;
    if (typeof description === "string") return description;
  }

  return `Invoke ${actionName}`;
}

function describeMcp(
  registry: NodeRegistry,
  config: McpConfig | undefined,
): ConsoleConfig["mcp"] {
  if (config === false) return { enabled: false, endpoints: [] };

  return {
    enabled: true,
    endpoints: [
      {
        path: DEFAULT_MCP_PATH,
        tools: Array.from(registry.actions).map(([actionName, action]) => ({
          name: mcpToolName(actionName),
          action: actionName,
          description: mcpToolDescription(actionName, action),
        })),
      },
    ],
  };
}

function serializeCELExpressions(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "object" || typeof value === "function") {
    const toCEL = (value as { [ToCEL]?: unknown })[ToCEL];
    if (typeof toCEL === "function") return toCEL.call(value);
  }

  if (Array.isArray(value)) return value.map(serializeCELExpressions);
  if (!isRecord(value)) return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      serializeCELExpressions(entry),
    ]),
  );
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

function routePathForAction(prefix: string, actionName: string): string {
  const separator = actionName.indexOf("::");
  if (separator === -1) return `${prefix}/${actionName.replace(/_/g, "-")}`;

  const actor = actionName.slice(0, separator);
  const action = actionName
    .slice(separator + 2)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
  return `${prefix}/${actor}/${action}`;
}

function actionParts(actionName: string): {
  actor: string;
  action: string;
  label: string;
} {
  const [actor = "TaskWish", action = actionName] = actionName.split("::");
  return {
    actor,
    action,
    label: sentenceFromIdentifier(action),
  };
}

function metaForAction(action: Action): Record<string, unknown> {
  const meta = (action as unknown as Record<symbol, unknown>)[TW_META];
  return isRecord(meta) ? meta : {};
}

function inputSchemaForAction(action: Action): unknown {
  return (action as unknown as Record<symbol, unknown>)[TW_INPUT_SCHEMA];
}

function isArkSchemaString(value: string): boolean {
  return (
    PRIMITIVE_ARK_SCHEMAS.has(value) ||
    PRIMITIVE_ARK_SCHEMAS.has(value.replace(/\[\]$/, ""))
  );
}

function jsonSchemaFromArkSchema(
  schema: unknown,
): ConsoleJsonSchema | undefined {
  if (schema === undefined) return undefined;

  try {
    return arkType.raw(schema as never).toJsonSchema() as ConsoleJsonSchema;
  } catch {
    return undefined;
  }
}

function fieldExample(
  schema: ConsoleJsonSchema | undefined,
  metadata: Record<string, unknown> | undefined,
): unknown {
  if (metadata && "example" in metadata) return metadata.example;
  return schema?.examples?.[0];
}

function fieldDefaultValue(schema: ConsoleJsonSchema | undefined): unknown {
  return schema && "default" in schema ? schema.default : undefined;
}

function fieldDescription(
  schema: ConsoleJsonSchema | undefined,
  meta: unknown,
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  if (metadata && typeof metadata.description === "string") {
    return metadata.description;
  }
  if (typeof schema?.description === "string") return schema.description;
  if (typeof meta === "string" && !isArkSchemaString(meta)) return meta;
  return undefined;
}

function fieldFromMeta(name: string, meta: unknown): ConsoleInputField {
  const schema =
    typeof meta === "string" && isArkSchemaString(meta)
      ? jsonSchemaFromArkSchema(meta)
      : isRecord(meta) && "schema" in meta
      ? jsonSchemaFromArkSchema(meta.schema)
      : undefined;
  const metadata = isRecord(meta) ? meta : undefined;

  return {
    name,
    description: fieldDescription(schema, meta, metadata),
    example: fieldExample(schema, metadata),
    defaultValue: fieldDefaultValue(schema),
    schema,
    metadata,
  };
}

function fieldsFromJsonSchema(
  schema: ConsoleJsonSchema | undefined,
  metadata: Record<string, unknown>,
): ConsoleInputField[] {
  if (!schema) return [];

  if (!isRecord(schema.properties)) {
    return [
      {
        name: "input",
        description: fieldDescription(schema, metadata.input, undefined),
        example: fieldExample(schema, undefined),
        defaultValue: fieldDefaultValue(schema),
        required: true,
        schema,
      },
    ];
  }

  return Object.entries(schema.properties).map(([name, property]) => {
    const fieldMeta = metadata[name];
    const fieldMetadata = isRecord(fieldMeta) ? fieldMeta : undefined;
    return {
      name,
      description: fieldDescription(property, fieldMeta, fieldMetadata),
      example: fieldExample(property, fieldMetadata),
      defaultValue: fieldDefaultValue(property),
      required: schema.required?.includes(name),
      schema: property,
      metadata: fieldMetadata,
    };
  });
}

function inputFieldsFromActionMeta(
  meta: Record<string, unknown>,
): ConsoleInputField[] {
  const input = meta.input;
  if (!isRecord(input)) return [];

  return Object.entries(input).map(([name, field]) =>
    fieldFromMeta(name, field),
  );
}

function actionInputMetadata(
  meta: Record<string, unknown>,
): Record<string, unknown> {
  return isRecord(meta.input) ? meta.input : {};
}

function inputFieldsFromRouteMeta(
  meta: Record<string, unknown>,
): ConsoleInputField[] {
  const route = meta.route;
  if (!Array.isArray(route)) return [];

  const schema = route[2];
  if (!isRecord(schema)) return [];

  const fields: ConsoleInputField[] = [];
  for (const section of ["params", "query", "body"] as const) {
    const value = schema[section];
    if (isRecord(value)) {
      for (const [name, fieldMeta] of Object.entries(value)) {
        fields.push(fieldFromMeta(name, fieldMeta));
      }
    }
  }
  return fields;
}

function inputSchemaFromRouteMeta(
  meta: Record<string, unknown>,
): ConsoleJsonSchema | undefined {
  const route = meta.route;
  if (!Array.isArray(route)) return undefined;

  const routeSchema = route[2];
  if (!isRecord(routeSchema)) return undefined;

  const schema: Record<string, unknown> = {};
  for (const section of ["params", "query", "body"] as const) {
    const value = routeSchema[section];
    if (isRecord(value)) Object.assign(schema, value);
  }

  return Object.keys(schema).length
    ? jsonSchemaFromArkSchema(schema)
    : undefined;
}

function sourceForMeta(meta: Record<string, unknown>): ConsoleAction["source"] {
  if (typeof meta.event === "string") return "event";
  if (typeof meta.trait === "string") return "trait";
  const route = meta.route;
  if (
    Array.isArray(route) &&
    typeof route[0] === "string" &&
    HTTP_ROUTE_METHODS.has(route[0])
  ) {
    return "http";
  }
  return "local";
}

function descriptionForMeta(meta: Record<string, unknown>): string | undefined {
  if (typeof meta.description === "string") return meta.description;

  const route = meta.route;
  if (Array.isArray(route) && isRecord(route[2])) {
    return typeof route[2].description === "string"
      ? route[2].description
      : undefined;
  }

  return undefined;
}

function isMessageEventAction(meta: Record<string, unknown>): boolean {
  return meta.event === "Message";
}

function scheduleForMeta(
  meta: Record<string, unknown>,
): ConsoleAction["schedule"] {
  if (!isRecord(meta.schedule)) return undefined;

  const expression = meta.schedule.expression;
  if (typeof expression !== "string" || expression.trim().length === 0) {
    return undefined;
  }

  const configuredTimezone = meta.schedule.timezone;
  const timezone =
    typeof configuredTimezone === "string" && configuredTimezone.length > 0
      ? configuredTimezone
      : Intl.DateTimeFormat().resolvedOptions().timeZone;

  return { expression, timezone };
}

function describeAction(
  actionName: string,
  action: Action,
  routePrefix: string,
): ConsoleAction {
  const { actor, action: method, label } = actionParts(actionName);
  const meta = serializeCELExpressions(metaForAction(action)) as Record<
    string,
    unknown
  >;
  const chatAction = isMessageEventAction(meta);
  const inputSchema =
    jsonSchemaFromArkSchema(inputSchemaForAction(action)) ??
    inputSchemaFromRouteMeta(meta);
  const input = inputSchema
    ? fieldsFromJsonSchema(inputSchema, actionInputMetadata(meta))
    : [...inputFieldsFromActionMeta(meta), ...inputFieldsFromRouteMeta(meta)];

  return {
    id: actionName,
    actor,
    action: chatAction ? "chat" : method,
    label: chatAction ? "Chat" : label,
    mode: chatAction ? "chat" : "form",
    description: descriptionForMeta(meta),
    route: routePathForAction(routePrefix, actionName),
    source: sourceForMeta(meta),
    input,
    inputSchema,
    schedule: scheduleForMeta(meta),
    meta,
  };
}

export function consoleConfig(
  registry: NodeRegistry,
  options: {
    nodeName: string;
    apiKey: string;
    prefix: string;
    mcp?: McpConfig;
  },
): ConsoleConfig {
  return {
    nodeName: options.nodeName,
    apiKey: options.apiKey,
    apiPrefix: options.prefix,
    mcp: describeMcp(registry, options.mcp),
    actions: Array.from(registry.actions)
      .map(([actionName, action]) =>
        describeAction(actionName, action, options.prefix),
      )
      .sort((left, right) =>
        `${left.actor} ${left.label}`.localeCompare(
          `${right.actor} ${right.label}`,
        ),
      ),
  };
}

export function createConsoleRoutes(
  registry: NodeRegistry,
  options: {
    nodeName: string;
    apiKey: string;
    prefix: string;
    mcp?: McpConfig;
  },
): NodeRoutes {
  const config: NodeRouteHandler = () =>
    json(200, consoleConfig(registry, options));
  const states: NodeRouteHandler = () =>
    json(
      200,
      Array.from(registry.states ?? [], ([actor, actorStates]) => ({
        actor,
        state: Object.assign({}, ...Object.values(actorStates)),
      })).sort((left, right) => left.actor.localeCompare(right.actor)),
    );
  const asset: NodeRouteHandler = (request) => consoleAsset(request);

  return {
    "/": { GET: asset },
    "/*": { GET: asset },
    [`${options.prefix}/console/config`]: {
      GET: config,
    },
    [`${options.prefix}/console/state`]: {
      GET: states,
    },
  };
}

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const consoleAppDirectories = [
  fileURLToPath(new URL("./app/", import.meta.url)),
  fileURLToPath(new URL("../dist/app/", import.meta.url)),
];

async function consoleAsset(request: Request): Promise<Response> {
  const pathname = decodeURIComponent(new URL(request.url).pathname);
  const requestedFile = pathname === "/" ? "index.html" : pathname.slice(1);
  const safeFile = requestedFile.includes("..") ? "index.html" : requestedFile;

  for (const directory of consoleAppDirectories) {
    for (const file of
      safeFile === "index.html" ? [safeFile] : [safeFile, "index.html"]) {
      try {
        const body = await readFile(join(directory, file));
        const bytes = new Uint8Array(body.byteLength);
        bytes.set(body);
        return new Response(bytes, {
          headers: {
            "Content-Type":
              CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
          },
        });
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
        ) {
          throw error;
        }
      }
    }
  }

  return new Response("Console assets are not built.", { status: 503 });
}

function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function shouldOpenBrowser(
  openBrowser: ConsoleOptions["openBrowser"],
): Promise<boolean> {
  if (openBrowser === true) return true;
  if (openBrowser === false) return false;
  if (!isInteractiveTerminal()) return false;

  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await prompt.question("Open Console in browser? (Y/n) ");
    return !/^(n|no)$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}

function browserOpenCommand(url: string): string[] {
  if (process.platform === "darwin") return ["open", url];
  if (process.platform === "win32") return ["cmd", "/c", "start", "", url];
  return ["xdg-open", url];
}

async function openBrowser(url: string): Promise<void> {
  const [command, ...args] = browserOpenCommand(url);
  await new Promise<void>((resolve, reject) => {
    const subprocess = spawn(command!, args, {
      stdio: "ignore",
      detached: process.platform !== "win32",
    });
    subprocess.once("error", reject);
    subprocess.once("spawn", () => {
      subprocess.unref();
      resolve();
    });
  });
}

function handleOpenBrowserError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`Could not open browser: ${message}`);
}

export function Console(options: ConsoleOptions = {}): ConsoleApp {
  return {
    name: "console",
    routes(context) {
      return createConsoleRoutes(context.registry, {
        nodeName: context.nodeName,
        apiKey: context.apiKey,
        prefix: context.prefix,
        mcp: context.mcp,
      });
    },
    async ready(context) {
      try {
        if (await shouldOpenBrowser(options.openBrowser ?? "ask")) {
          await openBrowser(context.server.url.origin);
        }
      } catch (error) {
        handleOpenBrowserError(error);
      }
    },
  };
}
