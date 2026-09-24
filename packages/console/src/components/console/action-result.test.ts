import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ActionInputBody,
  buildRunBubbles,
  signalPayloadLine,
  TraceLine,
} from "./action-result";

describe("action input formatting", () => {
  test("renders uploaded data as file cards without exposing base64", () => {
    const markup = renderToStaticMarkup(
      createElement(ActionInputBody, {
        input: {
          sourceId: "message-1042",
          attachments: [
            { name: "tender.pdf", contentBase64: "JVBERi0=" },
          ],
        },
      })
    );

    expect(markup).toContain("sourceId");
    expect(markup).toContain("tender.pdf");
    expect(markup).toContain("5 B");
    expect(markup).not.toContain("attachments[0]");
    expect(markup).toContain('data-slot="action-input-bubble"');
    expect(markup).toContain('data-slot="action-input-files"');
    expect(markup).not.toContain("JVBERi0=");
    expect(markup).not.toContain("contentBase64");
  });

  test("renders file-only input without an input bubble", () => {
    const markup = renderToStaticMarkup(
      createElement(ActionInputBody, {
        input: {
          attachments: [
            { name: "tender.pdf", contentBase64: "JVBERi0=" },
          ],
        },
      })
    );

    expect(markup).toContain('data-slot="action-input-files"');
    expect(markup).not.toContain('data-slot="action-input-bubble"');
    expect(markup).not.toContain("bg-black");
    expect(markup).toContain("border-border");
    expect(markup).toContain("bg-white");
  });
});

describe("signal trace formatting", () => {
  test("uses the wind signal marker and unwraps protocol data", () => {
    expect(
      signalPayloadLine({
        "->": "Greeter::Message",
        data: { name: "Ada" },
      })
    ).toBe("-> Message { name: Ada }");
  });

  test("emphasizes signal and result markers and dims tree branches", () => {
    const markup = renderToStaticMarkup(
      createElement(TraceLine, { line: "│ ├─ -> Message └─ ✓ Done" })
    );

    expect(markup).toContain(
      'class="text-muted-foreground opacity-50">│</span>'
    );
    expect(markup).toContain(
      'class="text-muted-foreground opacity-50">├─</span>'
    );
    expect(markup).toContain('class="font-bold">-&gt;</span>');
    expect(markup).toContain('class="font-bold">✓</span>');
    expect(markup).toContain(
      'class="text-muted-foreground opacity-50">└─</span>'
    );
  });

  test("keeps flat signal payloads intact", () => {
    expect(
      signalPayloadLine({
        "->": "Greeter::Message",
        name: "Ada",
      })
    ).toBe("-> Message { name: Ada }");
  });
});

describe("ACP result formatting", () => {
  test("renders awaited agent output and merges tool lifecycle updates", () => {
    const bubbles = buildRunBubbles(
      {
        status: 200,
        ok: true,
        contentType: "text/event-stream",
        body: "",
        streaming: true,
        events: [
          {
            type: "acp",
            message: "ACP::AgentMessageChunk",
            data: {
              sessionId: "session-1",
              update: {
                sessionUpdate: "agent_message_chunk",
                messageId: "message-1",
                content: { type: "text", text: "Hello " },
              },
            },
          },
          {
            type: "acp",
            message: "ACP::AgentMessageChunk",
            data: {
              sessionId: "session-1",
              update: {
                sessionUpdate: "agent_message_chunk",
                messageId: "message-1",
                content: { type: "text", text: "world" },
              },
            },
          },
          {
            type: "acp",
            message: "ACP::ToolCall",
            data: {
              sessionId: "session-1",
              update: {
                sessionUpdate: "tool_call",
                toolCallId: "tool-1",
                title: "Search",
                status: "in_progress",
                rawInput: { query: "TaskWish" },
              },
            },
          },
          {
            type: "acp",
            message: "ACP::ToolCallUpdate",
            data: {
              sessionId: "session-1",
              update: {
                sessionUpdate: "tool_call_update",
                toolCallId: "tool-1",
                status: "completed",
                rawOutput: "Found",
              },
            },
          },
          { type: "result", data: "Hello world" },
        ],
      },
      false
    );

    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]).toMatchObject({ type: "agent", body: "Hello world" });
    expect(bubbles[1]).toMatchObject({
      type: "tool",
      title: "Search",
    });
    expect(bubbles[1]?.body).toContain('"status": "completed"');
    expect(bubbles[1]?.body).toContain('"rawOutput": "Found"');
  });

  test("does not duplicate ACP agent text when TW stream output exists", () => {
    const bubbles = buildRunBubbles(
      {
        status: 200,
        ok: true,
        contentType: "text/event-stream",
        body: "Hello",
        streaming: true,
        events: [
          {
            type: "acp",
            message: "ACP::AgentMessageChunk",
            data: {
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "Hello" },
              },
            },
          },
          { type: "yield", data: "Hello" },
        ],
      },
      false
    );

    expect(bubbles.filter((bubble) => bubble.type === "agent")).toHaveLength(0);
    expect(bubbles.filter((bubble) => bubble.type === "yield")).toHaveLength(1);
  });
});
