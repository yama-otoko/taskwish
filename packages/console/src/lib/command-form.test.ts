import { describe, expect, test } from "bun:test";

import {
  buildPayload,
  fieldPlaceholder,
  formDefaultValues,
  listItemDefaultValue,
  streamActionResponse,
} from "./command-form";

describe("command form values", () => {
  test("uses examples only as placeholders", () => {
    const field = {
      name: "customerName",
      example: "Ada Lovelace",
      schema: { type: "string" },
    };

    expect(formDefaultValues([field])).toEqual({ customerName: "" });
    expect(fieldPlaceholder(field)).toBe("Ada Lovelace");
  });

  test("preserves explicit defaults separately from examples", () => {
    const field = {
      name: "customerName",
      example: "Ada Lovelace",
      defaultValue: "Grace Hopper",
      schema: { type: "string" },
    };

    expect(formDefaultValues([field])).toEqual({
      customerName: "Grace Hopper",
    });
    expect(fieldPlaceholder(field)).toBe("Ada Lovelace");
  });

  test("does not use nested object examples as new list item values", () => {
    const field = {
      name: "customers",
      example: [{ name: "Ada Lovelace" }],
      schema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              examples: ["Ada Lovelace"],
            },
          },
        },
      },
    };

    expect(formDefaultValues([field])).toEqual({ customers: [] });
    expect(listItemDefaultValue(field)).toEqual({ name: "" });
  });

  test("uses upload values directly for file fields", () => {
    const field = {
      name: "documents",
      required: true,
      schema: {
        type: "array",
        maxItems: 2,
        items: {
          type: "object",
          format: "taskwish-file",
          "x-taskwish-accept": ".pdf",
          "x-taskwish-max-bytes": 100,
        },
      },
    };
    const documents = [{ name: "load.pdf", contentBase64: "JVBERi0=" }];

    expect(formDefaultValues([field])).toEqual({ documents: [] });
    expect(buildPayload({ documents }, [field])).toEqual({ documents });
    expect(() => buildPayload({ documents: [] }, [field])).toThrow(
      "Choose a file",
    );
  });
});

async function finalStreamResult(body: string) {
  const response = new Response(body, {
    headers: { "Content-Type": "text/event-stream" },
  });
  let result;

  for await (const update of streamActionResponse(response)) result = update;

  return result;
}

describe("command response streams", () => {
  test("normalizes protocol trace data to the console log shape", async () => {
    const result = await finalStreamResult(
      'event: TW::Trace\ndata: {"path":"Greeter::hello","input":{"name":"Ada"}}\n\n'
    );

    expect(result?.events).toEqual([
      {
        type: "wind",
        data: { ">>": "Greeter::hello", input: { name: "Ada" } },
      },
    ]);
  });

  test("normalizes protocol signal data to the console log shape", async () => {
    const result = await finalStreamResult(
      'event: TW::Signal\ndata: {"event":"Greeter::Message","data":{"name":"Ada"}}\n\n'
    );

    expect(result?.events).toEqual([
      {
        type: "wind",
        data: { "->": "Greeter::Message", data: { name: "Ada" } },
      },
    ]);
  });

  test("preserves ACP message identity for the console renderer", async () => {
    const result = await finalStreamResult(
      'event: ACP::AgentMessageChunk\ndata: {"sessionId":"session-1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Hello"}}}\n\n'
    );

    expect(result?.events).toEqual([
      {
        type: "acp",
        message: "ACP::AgentMessageChunk",
        data: {
          sessionId: "session-1",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Hello" },
          },
        },
      },
    ]);
  });
});
