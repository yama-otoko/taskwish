import {
  RawLoggedStreamTag,
  RawStreamTag,
} from "@taskwish/core";
import { statePayload } from "@taskwish/state";
import {
  Message,
  Result,
  Signal,
  StateChange,
  StateResult,
  Stream,
  Trace,
} from "@taskwish/wind";
import {
  flattenRouteInput,
  parseActionInput,
  routeInputFromRequest,
} from "./request";
import { responseFrom, streamChunk } from "./response";
import type { Action, NodeRegistry, RouteMeta } from "./types";

type InvokeOptions = {
  includeWind: boolean;
  responseMode: "default" | "sse";
};

function inputFromSignal(signal: Signal<string, any>): unknown {
  return signal.data.data;
}

async function consumeAction(
  action: Action,
  args: unknown[],
  registry: NodeRegistry
): Promise<unknown> {
  if (!action.stream) return action(...args);

  const stream = action.stream(...args);
  let item = await stream.next();
  while (!item.done) {
    if (item.value instanceof Signal) dispatchSignal(item.value, registry);
    item = await stream.next();
  }
  return item.value;
}

function rawActionStream(
  action: Action,
  args: unknown[]
): AsyncGenerator<unknown, unknown, unknown> | null {
  const raw =
    (
      action as unknown as {
        [RawLoggedStreamTag]?: (
          ...args: unknown[]
        ) => AsyncGenerator<unknown, unknown>;
      }
    )[RawLoggedStreamTag] ??
    (
      action as unknown as {
        [RawStreamTag]?: (
          ...args: unknown[]
        ) => AsyncGenerator<unknown, unknown>;
      }
    )[RawStreamTag] ??
    action.stream;

  return raw ? raw(...args) : null;
}

function isStreamEvent(value: unknown): value is Stream<unknown> {
  return value instanceof Stream;
}

function isStateChangeEvent(value: unknown): value is StateChange {
  return value instanceof StateChange;
}

function acceptsServerSentEvents(request: Request): boolean {
  return (
    request.headers
      .get("Accept")
      ?.split(",")
      .some((value) =>
        value.trim().toLowerCase().startsWith("text/event-stream")
      ) ?? false
  );
}

function includesWindEvents(request: Request): boolean {
  const value = request.headers.get("wind");
  if (value === null) return false;

  const normalized = value.trim().toLowerCase();
  return (
    normalized === "" || !["0", "false", "off", "none"].includes(normalized)
  );
}

function invokeOptionsFromRequest(request: Request): InvokeOptions {
  return {
    includeWind: includesWindEvents(request),
    responseMode: acceptsServerSentEvents(request) ? "sse" : "default",
  };
}

function responseFromActionStream(
  stream: AsyncGenerator<unknown, unknown, unknown>,
  firstChunk: Stream<unknown>,
  registry: NodeRegistry
): Response {
  let pending: Stream<unknown> | null = firstChunk;

  return new Response(
    new ReadableStream({
      async pull(controller) {
        while (true) {
          if (pending) {
            const chunk = pending;
            pending = null;
            controller.enqueue(await streamChunk(chunk.data));
            return;
          }

          const item = await stream.next();
          if (item.done) {
            controller.close();
            return;
          }

          if (item.value instanceof Signal) {
            dispatchSignal(item.value, registry);
          } else if (isStreamEvent(item.value)) {
            controller.enqueue(await streamChunk(item.value.data));
            return;
          }
        }
      },
      async cancel() {
        await stream.return?.(undefined);
      },
    })
  );
}

function responseFromActionSseStream(
  stream: AsyncGenerator<unknown, unknown, unknown>,
  registry: NodeRegistry,
  options: InvokeOptions
): Response {
  return new Response(
    new ReadableStream({
      async pull(controller) {
        try {
          while (true) {
            const item = await stream.next();
            if (item.done) {
              if (item.value !== undefined) {
                const state = statePayload(item.value);
                if (state) {
                  const result = new StateResult(state.path, {
                    value: state.value,
                    ...(state.columns ? { columns: state.columns } : {}),
                  });
                  controller.enqueue(result.toSSE());
                } else {
                  const result = new Result(item.value);
                  controller.enqueue(result.toSSE());
                }
              }
              controller.close();
              return;
            }

            if (isStateChangeEvent(item.value)) {
              controller.enqueue(item.value.toSSE());
              return;
            } else if (item.value instanceof Signal) {
              dispatchSignal(item.value, registry);
              if (options.includeWind) {
                controller.enqueue(item.value.toSSE());
                return;
              }
            } else if (item.value instanceof Trace) {
              if (options.includeWind) {
                controller.enqueue(item.value.toSSE());
                return;
              }
            } else if (isStreamEvent(item.value)) {
              controller.enqueue(item.value.toSSE());
              return;
            } else if (item.value instanceof Message) {
              if (options.includeWind) {
                controller.enqueue(item.value.toSSE());
                return;
              }
            } else {
              const result = new Result(item.value);
              controller.enqueue(result.toSSE());
              return;
            }
          }
        } catch (error) {
          controller.enqueue(
            new Message("TW::Error", {
              error: error instanceof Error ? error.message : String(error),
            }).toSSE()
          );
          controller.close();
        }
      },
      async cancel() {
        await stream.return?.(undefined);
      },
    }),
    {
      headers: {
        "Cache-Control": "no-cache",
        "Content-Type": "text/event-stream; charset=utf-8",
      },
    }
  );
}

async function invokeAction(
  action: Action,
  args: unknown[],
  registry: NodeRegistry,
  options: InvokeOptions
): Promise<Response> {
  const stream = rawActionStream(action, args);
  if (!stream) return responseFrom(await action(...args));

  if (options.responseMode === "sse") {
    return responseFromActionSseStream(stream, registry, options);
  }

  let item = await stream.next();
  while (!item.done) {
    if (item.value instanceof Signal) {
      dispatchSignal(item.value, registry);
    } else if (isStreamEvent(item.value)) {
      return responseFromActionStream(stream, item.value, registry);
    }
    item = await stream.next();
  }

  return responseFrom(item.value);
}

function dispatchSignal(
  signal: Signal<string, any>,
  registry: NodeRegistry
): void {
  const handlers = registry.eventHandlers.get(signal.event) ?? [];
  const input = inputFromSignal(signal);
  for (const handler of handlers) {
    void consumeAction(handler, [input], registry).catch((error) => {
      console.error(error);
    });
  }
}

export async function invoke(
  action: Action,
  request: Request,
  registry: NodeRegistry
): Promise<Response> {
  const args = await parseActionInput(request);
  return invokeAction(
    action,
    args,
    registry,
    invokeOptionsFromRequest(request)
  );
}

export async function invokeRouteAction(
  action: Action,
  request: Request,
  registry: NodeRegistry,
  route: RouteMeta
): Promise<Response> {
  const [, routePath] = route;
  const rawInput = await routeInputFromRequest(routePath, request);
  return invokeAction(
    action,
    [flattenRouteInput(rawInput)],
    registry,
    invokeOptionsFromRequest(request)
  );
}
