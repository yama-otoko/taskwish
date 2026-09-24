import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Actor, Event, Step, TW } from "@taskwish/core";
import { State, Store } from "@taskwish/state";
import { Logger, formatEvent } from "@taskwish/wind";
import { createFetchHandler, createNodeRegistry } from "./index";
import { apiKey, auth } from "./test-helpers";

test("serves command actions with POST under /tw/<Actor>/<method>", async () => {
  const { actor } = Actor("Greeter");

  const { hello } = actor()
    .on("Command", "hello")

    .input({ name: "string" })

    .run(function () {
      return `Hello ${this.input.name}`;
    });
  const { Greeter } = actor().service({ hello });

  const fetch = createFetchHandler(
    createNodeRegistry([Promise.resolve({ Greeter, hello })]),
    { apiKey }
  );

  const response = await fetch(
    new Request("http://localhost/tw/Greeter/hello", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ada" }),
    })
  );

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("Hello Ada");
});

test("serves command actions with GET under /tw/<Actor>/<method>", async () => {
  const { actor } = Actor("Greeter");

  const { hello } = actor()
    .on("Command", "hello")

    .input({ name: "string" })

    .run(function () {
      return `Hello ${this.input.name}`;
    });
  const { Greeter } = actor().service({ hello });

  const fetch = createFetchHandler(
    createNodeRegistry([Promise.resolve({ Greeter, hello })]),
    { apiKey }
  );

  const response = await fetch(
    new Request("http://localhost/tw/Greeter/hello?name=Ada", {
      headers: auth,
    })
  );

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("Hello Ada");
});

test("streams Step pipe chunks from command actions", async () => {
  const { actor } = Actor("Piper");
  let releaseSecondChunk!: () => void;
  const waitForRelease = new Promise<void>((resolve) => {
    releaseSecondChunk = resolve;
  });

  const { count } = actor()
    .on("Command", "count")

    .input({ total: "number" })

    .run(
      Step("count", async function* () {
        yield "1\n";
        await waitForRelease;
        yield "2\n";
      }),

      Step(["|>", "double"], async function* (source) {
        for await (const chunk of source) {
          yield `${Number(chunk) * 2}\n`;
        }
      })
    );
  const { Piper } = actor().service({ count });

  const fetch = createFetchHandler(
    createNodeRegistry([Promise.resolve({ Piper, count })]),
    { apiKey }
  );

  const responseOrTimeout = await Promise.race([
    fetch(
      new Request("http://localhost/tw/Piper/count?total=2", {
        headers: auth,
      })
    ),
    Bun.sleep(50).then(() => "timeout" as const),
  ]);

  if (responseOrTimeout === "timeout") {
    releaseSecondChunk();
    throw new Error("Piper response did not start streaming");
  }

  const response = responseOrTimeout;
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const firstOrTimeout = await Promise.race([
    reader.read(),
    Bun.sleep(50).then(() => "timeout" as const),
  ]);

  if (firstOrTimeout === "timeout") {
    releaseSecondChunk();
    throw new Error("Piper response did not produce the first chunk");
  }

  expect(firstOrTimeout.done).toBe(false);
  expect(new TextDecoder().decode(firstOrTimeout.value)).toBe("2\n");

  releaseSecondChunk();

  const second = await reader.read();
  expect(second.done).toBe(false);
  expect(new TextDecoder().decode(second.value)).toBe("4\n");

  expect(await reader.read()).toEqual({ done: true, value: undefined });
});

test("streams command yields and wind traces as SSE for commander requests", async () => {
  const { actor } = Actor("Piper");

  const { count } = actor()
    .on("Command", "count")

    .input({ total: "number" })

    .run(
      Step("count", async function* () {
        for (let count = 1; count <= this.input.total; count++) {
          yield count;
        }
      }),

      Step(["|>", "double"], async function* (source) {
        for await (const chunk of source) {
          yield `${chunk * 2}\n`;
        }
      })
    );
  const { Piper } = actor().service({ count });

  const fetch = createFetchHandler(
    createNodeRegistry([Promise.resolve({ Piper, count })]),
    { apiKey }
  );

  const response = await fetch(
    new Request("http://localhost/tw/Piper/count?total=2", {
      headers: {
        ...auth,
        Accept: "text/event-stream",
        wind: "commander",
      },
    })
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toStartWith("text/event-stream");

  const body = await response.text();
  expect(body).toContain("event: TW::Trace");
  expect(body).toContain('data: {"path":"Piper::count"');
  expect(body).toContain("event: TW::Stream");
  expect(body).toContain('data: "2\\n"');
  expect(body).toContain('data: "4\\n"');
});

test("streams state results and state changes as dedicated SSE events", async () => {
  const directory = mkdtempSync(join(tmpdir(), "taskwish-server-state-"));

  try {
    const { actor } = Actor("Todos").scope(
      Store({ adapter: "fs", directory }),
      State({ items: State.List({ id: "string", done: "boolean" }) })
    );
    const { seed } = actor()
      .on("Command", "seed")
      .run(function () {
        this.state.items.push({ id: "one", done: false });
      });
    const { complete } = actor()
      .on("Command", "complete")
      .input({ id: "string" })
      .run(function () {
        const item = this.state.items.find(({ id }) => id === this.input.id)!;
        item.done = true;
        return item;
      });
    const { Todos } = actor().service({ complete });
    await seed();

    const fetch = createFetchHandler(
      createNodeRegistry([Promise.resolve({ Todos, complete })]),
      { apiKey }
    );
    const response = await fetch(
      new Request("http://localhost/tw/Todos/complete", {
        method: "POST",
        headers: {
          ...auth,
          Accept: "text/event-stream",
          "Content-Type": "application/json",
          wind: "commander",
        },
        body: JSON.stringify({ id: "one" }),
      })
    );
    const body = await response.text();

    expect(body).toContain(
      'data: {"path":"Todos::state.items","previous":[{"id":"one","done":false}],"value":[{"id":"one","done":true}],"columns":["id","done"]}'
    );
    expect(body).toContain("event: TW::StateChange");
    expect(body).toContain('"path":"state.items"');
    expect(body).toContain('"columns":["id","done"]');
    expect(body).toContain("event: TW::StateResult");
    expect(body).toContain('"done":true');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("streams wind trace error messages as SSE for commander requests", async () => {
  const { actor } = Actor("Crasher");
  const boom = new Error("boom");

  const { fail } = actor()
    .on("Command", "fail")

    .run(
      Step("bad", function () {
        throw boom;
      })
    );
  const { Crasher } = actor().service({ fail });

  const fetch = createFetchHandler(
    createNodeRegistry([Promise.resolve({ Crasher, fail })]),
    { apiKey }
  );

  const response = await fetch(
    new Request("http://localhost/tw/Crasher/fail", {
      headers: {
        ...auth,
        Accept: "text/event-stream",
        wind: "commander",
      },
    })
  );

  expect(response.status).toBe(200);

  const body = await response.text();
  expect(body).toContain("event: TW::Trace");
  expect(body).toContain(
    'data: {"path":"Crasher::fail.bad","error":{"message":"boom"}}'
  );
  expect(body).toContain(
    'data: {"path":"Crasher::fail","error":{"message":"boom"}}'
  );
  expect(body).toContain("event: TW::Error");
  expect(body).toContain('data: {"error":"boom"}');
});

test("logs traces when invoking command actions through fetch handlers", async () => {
  const logged: unknown[] = [];
  const spy = {
    log: logged.push.bind(logged),
    info: logged.push.bind(logged),
    error: logged.push.bind(logged),
  };
  const { actor } = Actor("Greeter");

  const { hello } = actor()
    .use(Logger(spy))

    .on("Command", "hello")

    .input({ name: "string" })

    .run(
      Step("prepare", function () {
        return this.input.name.toUpperCase();
      }),

      Step("greet", function () {
        return `Hello ${this.prepare}`;
      })
    );
  const { Greeter } = actor().service({ hello });

  const fetch = createFetchHandler(
    createNodeRegistry([Promise.resolve({ Greeter, hello })]),
    { apiKey }
  );

  const response = await fetch(
    new Request("http://localhost/tw/Greeter/hello?name=Ada", {
      headers: auth,
    })
  );

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("Hello ADA");
  expect(logged).toEqual([
    formatEvent({ ">>": "Greeter::hello", input: { name: "Ada" } }),
    formatEvent({ ">>": "Greeter::hello.prepare", result: "ADA" }),
    formatEvent({ ">>": "Greeter::hello.greet", result: "Hello ADA" }),
    formatEvent({ ">>": "Greeter::hello", result: "Hello ADA" }),
  ]);
});

test("serves actor event handlers with POST under /tw/<Actor>/<handler>", async () => {
  const { Greeter } = Actor("Greeter")
    .scope(Event("Message", { content: "string" }))
    .actor()
    .service();

  const { onGreeterMessage } = Actor("Biller")
    .use(Greeter)
    .actor()
    .on("Greeter::Message")

    .run(function () {
      return { received: this.input.content };
    });
  const { Biller } = Actor("Biller")
    .use(Greeter)
    .actor()
    .service({ onGreeterMessage });
  expect("onGreeterMessage" in Biller).toBe(false);

  expect(onGreeterMessage[TW.Meta]).toEqual({ event: "Greeter::Message" });

  const fetch = createFetchHandler(
    createNodeRegistry([Promise.resolve({ Greeter, Biller })]),
    { apiKey }
  );

  const response = await fetch(
    new Request("http://localhost/tw/Biller/on-greeter-message", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hi" }),
    })
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ received: "hi" });
});

test("serves actor event handlers with GET under /tw/<Actor>/<handler>", async () => {
  const { Greeter } = Actor("Greeter")
    .scope(Event("Message", { content: "string" }))
    .actor()
    .service();

  const { onGreeterMessage } = Actor("Biller")
    .use(Greeter)
    .actor()
    .on("Greeter::Message")

    .run(function () {
      return { received: this.input.content };
    });
  const { Biller } = Actor("Biller")
    .use(Greeter)
    .actor()
    .service({ onGreeterMessage });

  const fetch = createFetchHandler(
    createNodeRegistry([Promise.resolve({ Greeter, Biller })]),
    { apiKey }
  );

  const response = await fetch(
    new Request("http://localhost/tw/Biller/on-greeter-message?content=hi", {
      headers: auth,
    })
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ received: "hi" });
});

test("serves route actions from node fetch handlers", async () => {
  const { actor } = Actor("InvoiceProvider");

  const { getInvoices } = actor()
    .on("GET", "/invoices/:id", {
      params: { id: "string" },
      query: { page: "string" },
    })
    .command("getInvoices")
    .run(function () {
      return { id: this.input.id, page: this.input.page };
    });
  const { InvoiceProvider } = actor().service({ getInvoices });

  expect("fetch" in getInvoices).toBe(false);

  const fetch = createFetchHandler(
    createNodeRegistry([Promise.resolve({ InvoiceProvider, getInvoices })]),
    { apiKey }
  );

  const response = await fetch(
    new Request("http://localhost/invoices/inv-42?page=2")
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: "inv-42", page: "2" });
});

test("serves route action JSON body input from node fetch handlers", async () => {
  const { actor } = Actor("InvoiceProvider");

  const { createInvoice } = actor()
    .on("POST", "/invoices", {
      body: { id: "string", status: "string" },
    })
    .command("createInvoice")
    .run(function () {
      return { id: this.input.id, status: this.input.status };
    });
  const { InvoiceProvider } = actor().service({ createInvoice });

  const fetch = createFetchHandler(
    createNodeRegistry([Promise.resolve({ InvoiceProvider, createInvoice })]),
    { apiKey }
  );

  const response = await fetch(
    new Request("http://localhost/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "inv-42", status: "paid" }),
    })
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toStartWith("application/json");
  expect(await response.json()).toEqual({ id: "inv-42", status: "paid" });
});

test("rejects requests without the configured API key", async () => {
  const { actor } = Actor("Greeter");
  const { hello } = actor()
    .on("Command", "hello")

    .input({ name: "string" })

    .run(function () {
      return `Hello ${this.input.name}`;
    });
  const { Greeter } = actor().service({ hello });

  const fetch = createFetchHandler(
    createNodeRegistry([Promise.resolve({ Greeter, hello })]),
    { apiKey }
  );

  const response = await fetch(
    new Request("http://localhost/tw/Greeter/hello", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ada" }),
    })
  );

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
});
