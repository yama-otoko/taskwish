import { TW } from "@taskwish/core";

export type ServiceModule = Record<string, unknown>;
export type ServiceReference = ServiceModule | Promise<ServiceModule>;

export type Action = ((...args: unknown[]) => unknown) & {
  run?: (...args: unknown[]) => unknown;
  stream?: (...args: unknown[]) => AsyncGenerator<unknown, unknown, unknown>;
  [TW.Name]?: string;
  [TW.Meta]?: unknown;
  [TW.InputSchema]?: unknown;
};

export type McpConfig = boolean;

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export type RouteMeta = readonly [
  method: HttpMethod,
  path: string,
  schema: Record<string, unknown>,
];

export interface NodeAppContext {
  registry: NodeRegistry;
  nodeName: string;
  apiKey: string;
  prefix: string;
  /** MCP configuration exposed by this node. */
  mcp?: McpConfig;
}

export interface NodeAppReadyContext extends NodeAppContext {
  server: RuntimeServer;
}

export interface NodeApp {
  name?: string;
  routes?: (context: NodeAppContext) => NodeRoutes | Promise<NodeRoutes>;
  ready?: (context: NodeAppReadyContext) => void | Promise<void>;
}

export interface NodeConfig {
  workspace?: readonly ServiceReference[];
  apps?: readonly NodeApp[];
  /** Expose every registered action through MCP at `/actor`. Enabled by default. */
  mcp?: McpConfig;
  apiKey?: string;
  port?: number;
  hostname?: string;
  prefix?: string;
  development?: boolean;
}

export interface NodeRegistry {
  actions: Map<string, Action>;
  eventHandlers: Map<string, Action[]>;
  states?: Map<string, Record<string, unknown>>;
}

export type NodeRouteHandler = (
  request: Request,
) => Response | Promise<Response>;

export type NodeRouteMap = Partial<Record<HttpMethod, NodeRouteHandler>>;

export type NodeStaticRoute = Response;

export type NodeRoutes = Record<string, NodeRouteMap | NodeStaticRoute>;

export interface RuntimeServer {
  url: URL;
  port: number;
  hostname: string;
  stop(closeActiveConnections?: boolean): void | Promise<void>;
}

export type TaskWishNode = RuntimeServer & {
  name: string;
  apiKey: string;
  routes: NodeRoutes;
};
