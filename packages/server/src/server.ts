import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import { createNodeRegistry } from "./registry";
import { json } from "./response";
import { normalizePrefix } from "./routes";
import { createFetchHandlerFromRoutes, createRoutes } from "./routes";
import { startScheduledActions } from "./schedule";
import type {
  NodeAppReadyContext,
  NodeConfig,
  RuntimeServer,
  TaskWishNode,
} from "./types";
import { generateApiKey, isRecord } from "./utils";

const shutdownSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
const activeServers = new Set<RuntimeServer>();
let shutdownHandlersInstalled = false;
let shutdownInProgress = false;

const TASKWISH_BANNER = `
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀\x1b[1m⣠⣾⣿⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀\x1b[38;5;244m⢀⣴⣿⣷⣄\x1b[0m
⠀⠀⠀⠀⠀⠀⠀⠀⠀\x1b[1m⣠⣾⣿⣿⣿⡿⠋⠀⠀⠀⠀⠀⠀⠀⠀\x1b[38;5;244m⢀⣴⣿⣿⣿⣿⠟\x1b[0m
\x1b[1m⣠⣾⣷⣄⠀⠀⠀⣠⣾⣿⣿⣿⡿⠋⠀\x1b[38;5;244m⢀⣴⣿⣦⡀⠀⠀\x1b[38;5;244m⢀⣴⣿⣿⣿⣿⠟⠁⠀\x1b[0m
\x1b[1m⠻⣿⣿⣿⣷⣤⣾⣿⣿⣿⡿⠋⠀⠀⠀\x1b[38;5;244m⠙⢿⣿⣿⣿⣦\x1b[38;5;244m⣴⣿⣿⣿⣿⠟⠁⠀⠀⠀\x1b[0m
⠀\x1b[1m⠈⠻⣿⣿⣿⣿⣿⡿⠋⠀⠀⠀⠀⠀⠀⠀\x1b[38;5;244m⠙⢿⣿⣿⣿\x1b[38;5;244m⣿⣿⠟⠁⠀⠀⠀⠀⠀\x1b[0m
⠀⠀⠀\x1b[1m⠈⠻⣿⡿⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀\x1b[38;5;244m⠙⢿⣿\x1b[38;5;244m⠟\x1b[0m
`;

function exitCodeForSignal(signal: NodeJS.Signals): number {
  if (signal === "SIGINT") return 130;
  if (signal === "SIGTERM") return 143;
  if (signal === "SIGHUP") return 129;
  return 0;
}

async function stopActiveServers(): Promise<void> {
  const servers = Array.from(activeServers);
  activeServers.clear();

  await Promise.allSettled(servers.map((server) => server.stop(true)));
}

function installShutdownHandlers(): void {
  if (shutdownHandlersInstalled) return;
  shutdownHandlersInstalled = true;

  for (const signal of shutdownSignals) {
    process.once(signal, () => {
      if (shutdownInProgress) return;
      shutdownInProgress = true;

      void stopActiveServers().finally(() => {
        process.exit(exitCodeForSignal(signal));
      });
    });
  }
}

function registerServerForShutdown<T extends RuntimeServer>(server: T): T {
  installShutdownHandlers();
  activeServers.add(server);

  const stop = server.stop.bind(server);
  server.stop = async (closeActiveConnections?: boolean) => {
    activeServers.delete(server);
    return stop(closeActiveConnections);
  };

  return server;
}

function isPortUnavailableError(error: unknown): boolean {
  if (!isRecord(error)) return false;

  const code = error.code;
  if (code === "EADDRINUSE" || code === "EACCES") return true;

  const message = error.message;
  return (
    typeof message === "string" &&
    /address already in use|port.*in use|failed to start server/i.test(message)
  );
}

function randomPort(): number {
  return 49152 + Math.floor(Math.random() * (65535 - 49152 + 1));
}

function hasBunServer(): boolean {
  return typeof globalThis.Bun?.serve === "function";
}

async function nodeRequest(
  request: IncomingMessage,
  origin: string,
): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }

  const method = request.method ?? "GET";
  let body: Uint8Array<ArrayBuffer> | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const buffer = Buffer.concat(chunks);
    body = new Uint8Array(buffer.byteLength);
    body.set(buffer);
  }

  return new Request(new URL(request.url ?? "/", origin), {
    method,
    headers,
    body,
  });
}

async function sendNodeResponse(
  response: Response,
  output: ServerResponse,
): Promise<void> {
  output.statusCode = response.status;
  response.headers.forEach((value, name) => output.setHeader(name, value));

  if (!response.body) {
    output.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!output.write(value)) {
        await new Promise<void>((resolve) => output.once("drain", resolve));
      }
    }
  } finally {
    output.end();
    reader.releaseLock();
  }
}

async function serveWithNode(
  fetch: (request: Request) => Promise<Response>,
  config: NodeConfig,
): Promise<RuntimeServer> {
  const hostname = config.hostname ?? "0.0.0.0";
  let origin = `http://${hostname}:${config.port ?? 0}`;
  const nodeServer = createServer(async (request, response) => {
    try {
      await sendNodeResponse(
        await fetch(await nodeRequest(request, origin)),
        response,
      );
    } catch (error) {
      await sendNodeResponse(
        json(500, {
          error: error instanceof Error ? error.message : String(error),
        }),
        response,
      );
    }
  });

  let port = config.port ?? 0;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        nodeServer.once("error", reject);
        nodeServer.listen(port, hostname, () => {
          nodeServer.off("error", reject);
          resolve();
        });
      });
      break;
    } catch (error) {
      if (!isPortUnavailableError(error) || attempt === 9) throw error;
      port = randomPort();
    }
  }

  const address = nodeServer.address() as AddressInfo;
  const publicHostname =
    hostname === "0.0.0.0" || hostname === "::" ? "localhost" : hostname;
  origin = `http://${publicHostname}:${address.port}`;

  return {
    url: new URL(origin),
    port: address.port,
    hostname,
    async stop(closeActiveConnections = false) {
      if (closeActiveConnections) nodeServer.closeAllConnections?.();
      await new Promise<void>((resolve, reject) =>
        nodeServer.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

function serveWithRandomPortFallback(
  options: Bun.Serve.Options<any, any>,
): Bun.Server<any> {
  const requestedPort = "port" in options ? options.port : undefined;
  let nextOptions =
    requestedPort === undefined || requestedPort === 0
      ? ({ ...options, port: randomPort() } as Parameters<typeof Bun.serve>[0])
      : options;

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return Bun.serve(nextOptions);
    } catch (error) {
      if (!isPortUnavailableError(error) || attempt === 9) throw error;
      nextOptions = {
        ...options,
        port: randomPort(),
      } as Parameters<typeof Bun.serve>[0];
    }
  }

  throw new Error("Unable to start server");
}

function printStartupMessage(
  server: RuntimeServer,
  name: string,
  apiKey: string,
): void {
  console.log(`${TASKWISH_BANNER}

${name} running on ${server.url.origin}
API key: ${apiKey}`);
}

async function notifyAppsReady(
  apps: NodeConfig["apps"],
  context: NodeAppReadyContext,
): Promise<void> {
  await Promise.allSettled(apps?.map((app) => app.ready?.(context)) ?? []);
}

export async function Server(
  name: string,
  config: NodeConfig = {},
): Promise<TaskWishNode> {
  const apiKey = config.apiKey ?? generateApiKey();
  const registry = createNodeRegistry(config.workspace);
  const services = await registry;
  const routePrefix = normalizePrefix(config.prefix ?? "/tw");
  const routes = await createRoutes(registry, {
    prefix: routePrefix,
    apiKey,
    nodeName: name,
    apps: config.apps,
    mcp: config.mcp,
  });

  const fetch = createFetchHandlerFromRoutes(routes, routePrefix);
  const server = registerServerForShutdown(
    hasBunServer()
      ? (serveWithRandomPortFallback({
          port: config.port ?? 0,
          hostname: config.hostname,
          development: config.development,
          routes,
          idleTimeout: 0,
          fetch() {
            return json(404, { error: "Not Found" });
          },
        }) as unknown as RuntimeServer)
      : await serveWithNode(fetch, config),
  );

  let schedules;
  try {
    schedules = startScheduledActions(services);
  } catch (error) {
    await server.stop(true);
    throw error;
  }
  const stopServer = server.stop.bind(server);
  server.stop = async (closeActiveConnections?: boolean) => {
    schedules.stop();
    await stopServer(closeActiveConnections);
  };

  printStartupMessage(server, name, apiKey);
  void notifyAppsReady(config.apps, {
    registry: services,
    nodeName: name,
    apiKey,
    prefix: routePrefix,
    server,
  });

  return Object.assign(server, { name, apiKey, routes }) as TaskWishNode;
}
