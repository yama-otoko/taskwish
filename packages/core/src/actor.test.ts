/* oxlint-disable no-unused-vars, no-unused-expressions -- Compile-time assertions intentionally have no runtime use. */

import { expect, test, describe } from "bun:test";
import { ToCEL } from "@taskwish/expr";
import { Expect, Equal } from "./helpers";
import { Actor } from "./actor";
import { Action } from "./action";
import { TW } from "./core";
import { Step } from "./steps";
import { Event } from "./event";
import {
  Logger,
  Signal,
  Trace,
  formatEvent,
  messageLogData,
} from "@taskwish/wire";
import { Trait } from "./trait";

const eventDataList = (values: unknown[]) => values.map(messageLogData);

describe("Actor", () => {
  test("Command — plain handler with input", async () => {
    const { actor } = Actor("Greeter");

    const { greet } = actor()
      .on("Command", "greet")

      .input({ name: "string" })

      .run(function () {
        return `Hello ${this.input.name}`;
      });

    type T = typeof greet;
    type check = Expect<
      Equal<
        TW.Action<
          "Greeter::greet",
          (input: { name: string }) => Promise<string>,
          null
        >,
        T
      >
    >;

    expect(await greet({ name: "World" })).toEqual("Hello World");
  });

  test("Command — preserves the action name casing", () => {
    const { markTodoDone } = Actor("Todos")
      .actor()
      .on("Command", "markTodoDone")
      .run(function () {
        return true;
      });

    type check = Expect<
      Equal<
        typeof markTodoDone,
        TW.Action<"Todos::markTodoDone", () => Promise<boolean>, null>
      >
    >;

    expect(markTodoDone[TW.Name]).toBe("Todos::markTodoDone");
  });

  test("Command — ctx binds execution context", async () => {
    const controller = new AbortController();

    const { actor } = Actor("Greeter");

    const { greet } = actor()
      .on("Command", "greet")

      .input({ name: "string" })

      .run(function () {
        return {
          message: `Hello ${this.input.name}`,
          aborted: this.abortSignal === controller.signal,
        };
      });

    expect(
      await greet.ctx({ abortSignal: controller.signal }).run({
        name: "World",
      })
    ).toEqual({
      message: "Hello World",
      aborted: true,
    });
  });

  test("Command — passes context to actions injected with use()", async () => {
    const controller = new AbortController();

    const { readBareSignal } = Action("readBareSignal").run(function () {
      return this.abortSignal === controller.signal;
    });

    const { readSignal } = Actor("Worker")
      .actor()
      .on("Command", "readSignal")

      .run(function () {
        return this.abortSignal === controller.signal;
      });
    const { Worker } = Actor("Worker").actor().service({ readSignal });

    const { checkSignals } = Actor("Parent")
      .use(readBareSignal)
      .use(Worker)
      .actor()
      .on("Command", "checkSignals")

      .run(async function () {
        return {
          bare: await this.actions.readBareSignal(),
          actor: await this.actions.worker.readSignal(),
        };
      });

    await expect(
      checkSignals.ctx({ abortSignal: controller.signal }).run()
    ).resolves.toEqual({
      bare: true,
      actor: true,
    });
  });

  test("Command — ctx can override injected actions", async () => {
    const { doWork } = Actor("AnotherActor")
      .actor()
      .on("Command", "doWork")

      .input({ value: "string" })

      .run(function () {
        return `real:${this.input.value}`;
      });

    const { AnotherActor } = Actor("AnotherActor").actor().service({ doWork });

    const { command } = Actor("SomeActor")
      .use(AnotherActor)
      .actor()
      .on("Command", "command")

      .input({ value: "string" })

      .run(function () {
        return this.actions.anotherActor.doWork({
          value: this.input.value,
        });
      });

    const calls: unknown[] = [];
    const mockDoWork = async (input: { value: string }) => {
      calls.push(input);
      return `mock:${input.value}`;
    };

    await expect(command({ value: "prod" })).resolves.toEqual("real:prod");
    await expect(
      command
        .ctx({
          actions: {
            anotherActor: {
              doWork: mockDoWork,
            },
          },
        })
        .run({ value: "test" })
    ).resolves.toEqual("mock:test");
    expect(calls).toEqual([{ value: "test" }]);
  });

  test("Command — no input", async () => {
    const { actor } = Actor("Pinger");

    const { healthz } = actor()
      .on("Command", "healthz")

      .run(function () {
        return { status: "ok" };
      });

    expect(await healthz()).toEqual({ status: "ok" });
  });

  test("Command — step chain resolves to last step", async () => {
    const { actor } = Actor("Processor");

    const { process } = actor()
      .on("Command", "process")

      .input({ value: "number" })

      .run(
        Step("doubled", function () {
          return this.input.value * 2;
        }),

        Step("positive", function () {
          return this.doubled > 0;
        })
      );

    type T = typeof process;
    type check = Expect<
      Equal<
        TW.Action<
          "Processor::process",
          (input: { value: number }) => Promise<boolean>,
          null
        >,
        T
      >
    >;

    expect(await process({ value: 3 })).toEqual(true);
  });

  test("actor name prefixed in Action and Step events", async () => {
    const { actor } = Actor("Pipeline");

    const { run } = actor()
      .on("Command", "run")

      .input({ name: "string" })

      .run(
        Step("first", function () {
          return this.input.name.length;
        }),

        Step("second", function () {
          return this.first > 0;
        })
      );

    const yields: unknown[] = [];
    for await (const v of run.stream({ name: "hello" })) {
      yields.push(v);
    }

    expect(eventDataList(yields)).toEqual([
      { ">>": "Pipeline::run", input: { name: "hello" } },
      { ">>": "Pipeline::run.first", result: 5 },
      { ">>": "Pipeline::run.second", result: true },
      { ">>": "Pipeline::run", result: true },
    ]);

    const stream = run.stream({ name: "hello" });
    let item = await stream.next();
    while (!item.done) item = await stream.next();
    expect(item.value).toBe(true);
  });

  test("NewMessage — actor name prefixed, input carries message data", async () => {
    const { actor } = Actor("Broadcaster");

    const { onNewMessage } = actor()
      .on("NewMessage")

      .run(function () {
        return this.input.content.toUpperCase();
      });

    type T = typeof onNewMessage;
    type check = Expect<
      Equal<
        TW.Action<
          "Broadcaster::onNewMessage",
          (input: {
            sender: { name: string };
            content: string;
            channel: string;
          }) => Promise<string>,
          { event: "NewMessage" }
        >,
        T
      >
    >;

    const yields: unknown[] = [];
    for await (const v of onNewMessage.stream({
      sender: { name: "Alice" },
      content: "hi",
      channel: "general",
    })) {
      yields.push(v);
    }

    expect(eventDataList(yields)).toEqual([
      {
        ">>": "Broadcaster::onNewMessage",
        input: { sender: { name: "Alice" }, content: "hi", channel: "general" },
      },
      { ">>": "Broadcaster::onNewMessage", result: "HI" },
    ]);
  });

  test("Command error — yields step error, action error, then rethrows", async () => {
    const boom = new Error("boom");

    const { actor } = Actor("Crasher");

    const { failing } = actor()
      .on("Command", "failing")

      .input({ name: "string" })

      .run(
        Step("first", function () {
          return 1;
        }),

        Step("bad", function () {
          throw boom;
        }),

        Step("never", function () {
          return 3;
        })
      );

    const yields: unknown[] = [];
    let thrown: unknown;

    try {
      for await (const v of failing.stream({ name: "World" })) {
        yields.push(v);
      }
    } catch (e) {
      thrown = e;
    }

    expect(eventDataList(yields)).toEqual([
      { ">>": "Crasher::failing", input: { name: "World" } },
      { ">>": "Crasher::failing.first", result: 1 },
      { ">>": "Crasher::failing.bad", error: boom },
      { ">>": "Crasher::failing", error: boom },
    ]);
    expect(thrown).toBe(boom);
  });

  test("scope — custom event usable as on() trigger", async () => {
    const { actor } = Actor("Biller").scope(
      Event("InvoicePaid", { invoiceId: "string", amount: "number" })
    );

    const { InvoicePaid } = actor.events;
    type E = typeof InvoicePaid;
    type eventCheck = Expect<
      E extends TW.EventKind<
        `${string}::InvoicePaid`,
        { invoiceId: string; amount: number }
      >
        ? true
        : false
    >;
    expect(InvoicePaid[TW.Name]).toEqual("Biller::InvoicePaid");

    const { onBillerInvoicePaid } = actor()
      .on("Biller::InvoicePaid")

      .run(function () {
        return `invoice: ${this.input.invoiceId}, amount: ${this.input.amount}`;
      });

    type T = typeof onBillerInvoicePaid;
    type check = Expect<
      T extends TW.Action<
        `${string}::onBillerInvoicePaid`,
        (input: { invoiceId: string; amount: number }) => Promise<string>,
        { event: "Biller::InvoicePaid" }
      >
        ? true
        : false
    >;

    expect(
      await onBillerInvoicePaid({ invoiceId: "inv-1", amount: 99 })
    ).toEqual("invoice: inv-1, amount: 99");
  });

  test("scope — does not inject EventKind into behavior handlers", async () => {
    const { actor } = Actor("Biller").scope(
      Event("InvoicePaid", {
        invoiceId: "string",
        amount: "number",
        customer: "string",
      })
    );

    const { processPayment } = actor()
      .on("Command", "processPayment")

      .input({ invoiceId: "string" })

      .run(function () {
        // @ts-expect-error signal kinds are internal metadata, not user scope
        this.InvoicePaid;
        expect("InvoicePaid" in this).toEqual(false);
        return `processed: ${this.input.invoiceId}`;
      });

    expect(await processPayment({ invoiceId: "inv-123" })).toEqual(
      "processed: inv-123"
    );
  });

  test("scope — Signal emit yields signal data", async () => {
    const { actor } = Actor("Biller").scope(
      Event("InvoicePaid", {
        invoiceId: "string",
        amount: "number",
        customer: "string",
      })
    );

    const { chargeCustomer } = actor()
      .on("Command", "chargeCustomer")

      .input({ invoiceId: "string", amount: "number" })

      .run(
        Step("invoicePaid", function () {
          return this.signal("Biller::InvoicePaid", {
            invoiceId: this.input.invoiceId,
            amount: this.input.amount,
            customer: "alice",
          });
        })
      );

    const yields: unknown[] = [];
    for await (const v of chargeCustomer.stream({
      invoiceId: "inv-1",
      amount: 100,
    })) {
      yields.push(v);
    }

    const emitted = yields.find(
      (value) =>
        value instanceof Signal && value.event === "Biller::InvoicePaid"
    );

    expect(emitted).toBeInstanceOf(Signal);
    expect(emitted).toMatchObject({
      data: {
        event: "Biller::InvoicePaid",
        data: {
          invoiceId: "inv-1",
          amount: 100,
          customer: "alice",
        },
      },
    });
  });

  test("use — imports another actor's event as a trigger", async () => {
    const invoicePaidSchema = {
      invoiceId: "string",
      amount: "number",
      customer: "string",
    } as const;

    const { chargeCustomer } = Actor("Biller")
      .scope(Event("InvoicePaid", invoicePaidSchema))
      .actor()
      .on("Command", "chargeCustomer")

      .input({ invoiceId: "string", amount: "number" })

      .run(
        Step("invoicePaid", function () {
          return this.signal("Biller::InvoicePaid", {
            invoiceId: this.input.invoiceId,
            amount: this.input.amount,
            customer: "alice",
          });
        })
      );

    const { Biller } = Actor("Biller")
      .scope(Event("InvoicePaid", invoicePaidSchema))
      .actor()
      .service({ chargeCustomer });

    const { onBillerInvoicePaid } = Actor("Listener")
      .use(Biller)
      .actor()
      .on("Biller::InvoicePaid")

      .run(function () {
        return `${this.input.customer}:${this.input.invoiceId}`;
      });

    type T = typeof onBillerInvoicePaid;
    type Meta = T[typeof TW.Meta];
    type check = Expect<
      Meta extends {
        event: "Biller::InvoicePaid";
        ctx: {
          abortSignal?: AbortSignal;
          actions?: {
            biller?: {
              chargeCustomer?: typeof chargeCustomer.run;
            };
          };
        };
      }
        ? true
        : false
    >;

    const emitted: unknown[] = [];
    for await (const event of chargeCustomer.stream({
      invoiceId: "inv-1",
      amount: 100,
    })) {
      emitted.push(event);
    }

    const invoicePaid = emitted.find(
      (value) =>
        value instanceof Signal && value.event === "Biller::InvoicePaid"
    );

    expect(invoicePaid).toBeInstanceOf(Signal);
    expect(invoicePaid).toMatchObject({
      data: {
        event: "Biller::InvoicePaid",
        data: {
          invoiceId: "inv-1",
          amount: 100,
          customer: "alice",
        },
      },
    });
    expect(
      await onBillerInvoicePaid({
        invoiceId: "inv-1",
        amount: 100,
        customer: "alice",
      })
    ).toEqual("alice:inv-1");
  });

  test("use — imports service scope events from TW.Scope", async () => {
    const { Biller } = Actor("Biller")
      .scope(
        Event("InvoicePaid", {
          invoiceId: "string",
          amount: "number",
          customer: "string",
        })
      )
      .actor()
      .service();

    expect((Biller as any)[TW.Scope].InvoicePaid[TW.Name]).toBe(
      "Biller::InvoicePaid"
    );

    const { onBillerInvoicePaid } = Actor("Listener")
      .use(Biller)
      .actor()
      .on("Biller::InvoicePaid")

      .run(function () {
        return `${this.input.customer}:${this.input.invoiceId}`;
      });

    type T = typeof onBillerInvoicePaid;
    type check = Expect<
      T extends TW.Action<
        "Listener::onBillerInvoicePaid",
        (input: {
          invoiceId: string;
          amount: number;
          customer: string;
        }) => Promise<string>,
        { event: "Biller::InvoicePaid" }
      >
        ? true
        : false
    >;

    expect(
      await onBillerInvoicePaid({
        invoiceId: "inv-1",
        amount: 100,
        customer: "alice",
      })
    ).toEqual("alice:inv-1");
  });

  test("use — accepts a single event definition and on() accepts EventKind", async () => {
    const { VoiceCall } = Event("VoiceCall", {
      callId: "string",
      from: "string",
    });

    const { actor } = Actor("Agent").use(VoiceCall);

    const { onVoiceCall } = actor()
      .on(VoiceCall)

      .run(function () {
        return `${this.input.callId}:${this.input.from}`;
      });

    type T = typeof onVoiceCall;
    type check = Expect<
      Equal<
        TW.Action<
          "Agent::onVoiceCall",
          (input: { callId: string; from: string }) => Promise<string>,
          { event: "VoiceCall" }
        >,
        T
      >
    >;

    expect(
      await onVoiceCall({
        callId: "call-1",
        from: "Ada",
      })
    ).toEqual("call-1:Ada");
  });

  test("Event descriptor command — scoped Message exposes chat", async () => {
    const { actor } = Actor("Assistant").scope(
      Event(
        { name: "Message", command: "chat" },
        { sessionId: "string", content: "string" },
        "|",
        "void"
      )
    );

    const { chat } = actor()
      .on("Message")

      .run(function () {
        type Input = typeof this.input;
        type inputCheck = Expect<
          Equal<
            Input,
            TW.Union<{ sessionId: string; content: string } | void>
          >
        >;

        expect(this.input).toBeInstanceOf(TW.Union);
        const input = this.input.unwrap();
        return input ? input.content : "empty";
      });

    type T = typeof chat;
    type check = Expect<
      Equal<
        TW.Action<
          "Assistant::chat",
          (input: { sessionId: string; content: string } | void) => Promise<
            string
          >,
          { event: "Message"; command: "chat" }
        >,
        T
      >
    >;

    expect(chat[TW.Name]).toEqual("Assistant::chat");
    expect(chat[TW.Meta]).toEqual({ event: "Message", command: "chat" });
    expect(await chat({ sessionId: "session-1", content: "hello" })).toEqual(
      "hello"
    );
  });

  test("Event descriptor command — EventKind on() exposes command", async () => {
    const { TicketCreated } = Event(
      { name: "TicketCreated", command: "openTicket" },
      { id: "string" }
    );

    const { actor } = Actor("Support").use(TicketCreated);

    const { openTicket } = actor()
      .on(TicketCreated)

      .run(function () {
        return this.input.id;
      });

    type T = typeof openTicket;
    type check = Expect<
      Equal<
        TW.Action<
          "Support::openTicket",
          (input: { id: string }) => Promise<string>,
          { event: "TicketCreated"; command: "openTicket" }
        >,
        T
      >
    >;

    expect(TicketCreated[TW.Meta]).toEqual({ command: "openTicket" });
    expect(openTicket[TW.Name]).toEqual("Support::openTicket");
    expect(openTicket[TW.Meta]).toEqual({
      event: "TicketCreated",
      command: "openTicket",
    });
    expect(await openTicket({ id: "ticket-1" })).toEqual("ticket-1");
  });

  test("Schedule — injects this.input with expression and runtime at", async () => {
    const { actor } = Actor("Scheduler");

    const { onSchedule } = actor()
      .on("Schedule", "0 9 * * 1-5")

      .run(function () {
        return `${
          this.input.expression
        } fired at ${this.input.at.toISOString()}`;
      });

    type T = typeof onSchedule;
    type check = Expect<
      Equal<
        TW.Action<
          "Scheduler::onSchedule",
          (input: { expression: string; at: Date }) => Promise<string>,
          null
        >,
        T
      >
    >;

    const at = new Date("2026-01-13T09:00:00Z");
    expect(await onSchedule({ expression: "0 9 * * 1-5", at })).toEqual(
      "0 9 * * 1-5 fired at 2026-01-13T09:00:00.000Z"
    );
  });

  test("Schedule — supports command names with runtime metadata", async () => {
    const { actor } = Actor("Scheduler");

    const { refreshRevenue } = actor()
      .on("Schedule", {
        expression: "0 9 * * 1-5",
        timezone: "Europe/Belgrade",
        protect: true,
      })
      .command("refreshRevenue")

      .run(function () {
        return this.input.at;
      });

    expect(refreshRevenue[TW.Name]).toBe("Scheduler::refreshRevenue");
    expect(refreshRevenue[TW.Meta]).toEqual({
      schedule: {
        expression: "0 9 * * 1-5",
        timezone: "Europe/Belgrade",
        protect: true,
      },
    });

    const at = new Date("2026-01-13T08:00:00Z");
    expect(await refreshRevenue({ at })).toEqual(at);
  });

  test("Schedule — always defaults to onSchedule", async () => {
    const { actor } = Actor("Accounting");

    const { onSchedule } = actor()
      .on("Schedule", "0 9 1 * *")

      .run(function () {
        return this.input.expression;
      });

    expect(onSchedule[TW.Name]).toBe("Accounting::onSchedule");
    expect(onSchedule[TW.Meta]).toEqual({
      schedule: { expression: "0 9 1 * *" },
    });
  });

  test("GET — with schema and command, named action takes flat input and route metadata", async () => {
    const { actor } = Actor("InvoiceProvider").scope(
      Event("InvoiceFetched", { id: "string", page: "string" })
    );

    const { getInvoices } = actor()
      .on("GET", "/invoices/:id", {
        params: { id: "string" },
        query: { page: "string" },
      })

      .command("getInvoices")

      .run(function () {
        return {
          id: this.input.id,
          page: this.input.page,
        };
      })

      .meta({
        description: "Get an invoice by id",
        input: {
          id: {
            description: "Invoice identifier",
            example: "inv-42",
          },
          page: {
            description: "Result page",
            example: "2",
          },
        },
        output: {
          id: "Invoice identifier",
          page: "Result page",
        },
      });

    actor()
      .on("GET", "/invoices/:id", {
        params: { id: "string" },
        query: { page: "string" },
      })

      .command("invalidMeta")

      .run(function () {
        return { ok: true };
      })

      .meta({
        input: {
          // @ts-expect-error metadata input keys must exist in the command scope input
          missing: "Not a command input",
        },
      });

    type T = typeof getInvoices;
    type check = Expect<
      T extends TW.Action<
        `${string}::getInvoices`,
        (input: { id: string; page: string }) => Promise<{
          id: string;
          page: string;
        }>,
        {
          route: [
            "GET",
            "/invoices/:id",
            {
              params: {
                id: "string";
              };
              query: {
                page: "string";
              };
              description: "Get an invoice by id";
              input: {
                id: {
                  description: "Invoice identifier";
                  example: "inv-42";
                };
                page: {
                  description: "Result page";
                  example: "2";
                };
              };
              output: {
                id: "Invoice identifier";
                page: "Result page";
              };
            }
          ];
        }
      >
        ? true
        : false
    >;

    expect(await getInvoices({ id: "inv-42", page: "2" })).toEqual({
      id: "inv-42",
      page: "2",
    });
    expect(getInvoices[TW.Meta]).toEqual({
      route: [
        "GET",
        "/invoices/:id",
        {
          params: { id: "string" },
          query: { page: "string" },
          description: "Get an invoice by id",
          input: {
            id: {
              description: "Invoice identifier",
              example: "inv-42",
            },
            page: {
              description: "Result page",
              example: "2",
            },
          },
          output: {
            id: "Invoice identifier",
            page: "Result page",
          },
        },
      ],
    });

    const directYields: unknown[] = [];
    for await (const v of getInvoices.stream({ id: "inv-42", page: "2" })) {
      directYields.push(v);
    }
    expect(eventDataList(directYields)).toEqual([
      {
        ">>": "InvoiceProvider::getInvoices",
        input: { id: "inv-42", page: "2" },
      },
      {
        ">>": "InvoiceProvider::getInvoices",
        result: { id: "inv-42", page: "2" },
      },
    ]);

    expect("fetch" in getInvoices).toBe(false);
  });

  test("NewEmail — input carries email fields", async () => {
    const { actor } = Actor("Mailer");

    const { onNewEmail } = actor()
      .on("NewEmail")

      .run(function () {
        return `New email from ${this.input.from}: ${this.input.subject}`;
      });

    type T = typeof onNewEmail;
    type check = Expect<
      Equal<
        TW.Action<
          "Mailer::onNewEmail",
          (input: {
            from: string;
            to: string;
            subject: string;
            body: string;
          }) => Promise<string>,
          { event: "NewEmail" }
        >,
        T
      >
    >;

    expect(
      await onNewEmail({
        from: "alice@example.com",
        to: "support@co.com",
        subject: "Help",
        body: "...",
      })
    ).toEqual("New email from alice@example.com: Help");
  });

  test("NewEmail — input available inside Step, events are prefixed", async () => {
    const { actor } = Actor("MailAgent");

    const { onNewEmail } = actor()
      .on("NewEmail")

      .run(
        Step("log", function () {
          return `${this.input.from}: ${this.input.subject}`;
        })
      );

    const yields: unknown[] = [];
    for await (const v of onNewEmail.stream({
      from: "bob@example.com",
      to: "me@co.com",
      subject: "Invoice",
      body: "",
    })) {
      yields.push(v);
    }

    expect(eventDataList(yields)).toEqual([
      {
        ">>": "MailAgent::onNewEmail",
        input: {
          from: "bob@example.com",
          to: "me@co.com",
          subject: "Invoice",
          body: "",
        },
      },
      {
        ">>": "MailAgent::onNewEmail.log",
        result: "bob@example.com: Invoice",
      },
      {
        ">>": "MailAgent::onNewEmail",
        result: "bob@example.com: Invoice",
      },
    ]);
  });

  test("service — keeps listeners separate from public actions", () => {
    const { actor } = Actor("Greeter");

    const { hello } = actor()
      .on("Command", "hello")

      .input({ name: "string" })

      .run(function () {
        return `Hello ${this.input.name}`;
      });

    const { onNewEmail } = actor()
      .on("NewEmail")

      .run(
        Step("greet", function () {
          return this.thread.reply(`Hello ${this.thread.sender.name}!`);
        })
      );

    const { Greeter } = actor().service({
      hello,
      onNewEmail,
    });

    type T = (typeof Greeter)[typeof TW.Listeners];
    type check = Expect<Equal<T, { onNewEmail: typeof onNewEmail }>>;
    type serviceActionsCheck = Expect<
      Equal<Pick<typeof Greeter, "hello">, { hello: typeof hello }>
    >;

    expect(Greeter.hello).toBe(hello);
    expect("run" in Greeter).toBe(false);
    expect("stream" in Greeter).toBe(false);
    expect("onNewEmail" in Greeter).toBe(false);
    expect((Greeter as any)[TW.Listeners]).toEqual([onNewEmail]);
    expect(Object.keys(Greeter)).not.toContain(String(TW.Listeners));
  });

  test("service — exports event actions that declare commands", async () => {
    const { actor } = Actor("FxAgent");

    const { chat } = actor()
      .on("Message")
      .run(function () {
        const input = this.input.unwrap();
        return input ? input.content : "empty";
      });

    const { FxAgent } = actor().service({ chat });

    type serviceActionsCheck = Expect<
      Equal<Pick<typeof FxAgent, "chat">, { chat: typeof chat }>
    >;
    type listenersCheck = Expect<
      Equal<(typeof FxAgent)[typeof TW.Listeners], {}>
    >;

    expect(FxAgent.chat).toBe(chat);
    await expect(FxAgent.chat()).resolves.toBe("empty");
    expect((FxAgent as any)[TW.Listeners]).toBeUndefined();
  });

  test("service — rejects legacy public and listeners keys", () => {
    const { actor } = Actor("Greeter");
    const { hello } = actor()
      .on("Command", "hello")
      .run(function () {
        return "Hello";
      });

    expect(() =>
      // @ts-expect-error public/listeners service keys are no longer supported
      actor().service({
        public: [hello],
      })
    ).toThrow(/public\/listeners keys are no longer supported/);

    expect(() =>
      // @ts-expect-error public/listeners service keys are no longer supported
      actor().service({
        listeners: [hello],
      })
    ).toThrow(/public\/listeners keys are no longer supported/);
  });

  test("signal — typed from scope, Step yields event then step result, chained step reads value", async () => {
    const { actor } = Actor("Emitter").scope(
      Event("OrderPlaced", { orderId: "string", amount: "number" })
    );

    const { emit } = actor()
      .on("Command", "emit")

      .input({ orderId: "string", amount: "number" })

      .run(
        Step("order", function () {
          return this.signal("Emitter::OrderPlaced", {
            orderId: this.input.orderId,
            amount: this.input.amount,
          });
        }),

        Step("confirm", function () {
          return `placed: ${this.order.data.orderId}`;
        })
      );

    const yields: unknown[] = [];
    for await (const v of emit.stream({ orderId: "ord-1", amount: 100 })) {
      yields.push(v);
    }

    expect(yields[1]).toBeInstanceOf(Signal);
    expect(eventDataList(yields)).toEqual([
      {
        ">>": "Emitter::emit",
        input: { orderId: "ord-1", amount: 100 },
      },
      {
        "->": "Emitter::OrderPlaced",
        data: { orderId: "ord-1", amount: 100 },
      },
      {
        ">>": "Emitter::emit.order",
        result: {
          event: "Emitter::OrderPlaced",
          data: { orderId: "ord-1", amount: 100 },
        },
      },
      { ">>": "Emitter::emit.confirm", result: "placed: ord-1" },
      { ">>": "Emitter::emit", result: "placed: ord-1" },
    ]);
  });

  test("use(Logger) — logs Action and Step events in order", async () => {
    const logged: unknown[] = [];
    const spy = {
      log: logged.push.bind(logged),
      info: logged.push.bind(logged),
      error: logged.push.bind(logged),
    };

    const { actor } = Actor("Worker");

    const { run } = actor()
      .use(Logger(spy))

      .on("Command", "run")

      .input({ value: "number" })

      .run(
        Step("doubled", function () {
          return this.input.value * 2;
        }),

        Step("positive", function () {
          return this.doubled > 0;
        })
      );

    await run({ value: 5 });

    expect(logged).toEqual([
      formatEvent({ ">>": "Worker::run", input: { value: 5 } }),
      formatEvent({ ">>": "Worker::run.doubled", result: 10 }),
      formatEvent({ ">>": "Worker::run.positive", result: true }),
      formatEvent({ ">>": "Worker::run", result: true }),
    ]);
  });

  test("use(Logger) — stream also logs", async () => {
    const logged: unknown[] = [];
    const spy = {
      log: logged.push.bind(logged),
      info: logged.push.bind(logged),
      error: logged.push.bind(logged),
    };

    const { actor } = Actor("Counter");
    const { tick } = actor()
      .use(Logger(spy))

      .on("Command", "tick")

      .input({ n: "number" })

      .run(
        Step("doubled", function () {
          return this.input.n * 2;
        }),

        Step("positive", function () {
          return this.doubled > 0;
        })
      );

    const yields: unknown[] = [];
    for await (const v of tick.stream({ n: 3 })) {
      yields.push(v);
    }

    expect(logged).toEqual(
      eventDataList(yields).flatMap((v) => {
        if (typeof v !== "object" || v === null || !(">>" in (v as object)))
          return [v];
        const e = v as Record<string, unknown>;
        const out = formatEvent(e);
        const items: unknown[] = [];
        items.push(out);
        return items;
      })
    );
  });

  test("use(Logger) — formats signal events without class or symbol metadata", async () => {
    const logged: unknown[] = [];
    const spy = {
      log: logged.push.bind(logged),
      info: logged.push.bind(logged),
      error: logged.push.bind(logged),
    };

    const { actor } = Actor("Greeter").scope(
      Event("Message", { content: "string" })
    );

    const { hello } = actor()
      .use(Logger(spy))

      .on("Command", "hello")

      .input({ name: "string" })

      .run(function () {
        return this.signal("Greeter::Message", { content: this.input.name });
      });

    await hello({ name: "Ada" });

    expect(logged).toContain(
      formatEvent({ "->": "Greeter::Message", data: { content: "Ada" } })
    );
  });

  test("use(Logger) — applies to all behaviors on the same instance", async () => {
    const logged: unknown[] = [];
    const spy = {
      log: logged.push.bind(logged),
      info: logged.push.bind(logged),
      error: logged.push.bind(logged),
    };

    const { actor } = Actor("Hub");
    const hubBehavior = actor().use(Logger(spy));

    const { ping } = hubBehavior
      .on("Command", "ping")

      .input({ id: "string" })

      .run(
        Step("upper", function () {
          return this.input.id.toUpperCase();
        })
      );

    const { onNewMessage } = hubBehavior.on("NewMessage").run(
      Step("excerpt", function () {
        return this.input.content.slice(0, 3);
      })
    );

    await ping({ id: "abc" });
    await onNewMessage({
      sender: { name: "Alice" },
      content: "hello",
      channel: "general",
    });

    expect(logged).toEqual([
      formatEvent({ ">>": "Hub::ping", input: { id: "abc" } }),
      formatEvent({ ">>": "Hub::ping.upper", result: "ABC" }),
      formatEvent({ ">>": "Hub::ping", result: "ABC" }),
      formatEvent({
        ">>": "Hub::onNewMessage",
        input: {
          sender: { name: "Alice" },
          content: "hello",
          channel: "general",
        },
      }),
      formatEvent({ ">>": "Hub::onNewMessage.excerpt", result: "hel" }),
      formatEvent({ ">>": "Hub::onNewMessage", result: "hel" }),
    ]);
  });

  test("multiple behaviors from same actor instance", async () => {
    const { actor } = Actor("Conductor");

    const { greet } = actor()
      .on("Command", "greet")

      .input({ name: "string" })

      .run(function () {
        return `hi ${this.input.name}`;
      });

    const { onNewMention } = actor()
      .on("NewMention")

      .run(function () {
        return `mentioned by ${this.input.sender.name}: ${this.input.text}`;
      });

    expect(await greet({ name: "Alice" })).toEqual("hi Alice");
    expect(
      await onNewMention({
        sender: { name: "Bob" },
        text: "hello",
        channel: "general",
      })
    ).toEqual("mentioned by Bob: hello");
  });

  describe("use(object) — scoped action injection", () => {
    test("meta options can use an injected conversationsList action for Slack.postMessage", async () => {
      const channels = [
        { id: "C123", name: "general" },
        { id: "C456", name: "engineering" },
      ];

      const { conversationsList } = Actor("Slack")
        .actor()

        .on("Command", "conversationsList")

        .input({ types: "string" })

        .run(function () {
          return {
            ok: true,
            channels:
              this.input.types === "public_channel"
                ? channels
                : channels.slice(1),
          };
        });

      const { Slack } = Actor("Slack").actor().service({ conversationsList });

      const { postMessage } = Actor("Slack")
        .use(Slack)

        .on("Command", "postMessage")

        .input({ channel: "string", text: "string" })

        .run(
          Step("channels", function () {
            return this.actions.slack.conversationsList({
              types: "public_channel",
            });
          }),

          Step("message", function () {
            const selected = this.channels.channels.find(
              (item) => item.id === this.input.channel
            );

            return {
              channel: selected,
              text: this.input.text,
            };
          })
        )

        .meta({
          description: "Post a message to a Slack channel",
          input: {
            channel: {
              description: "Channel receiving the message",
              example: "#general",
              suggestions: {
                $: "Slack::conversationsList",
                "*": ($) =>
                  $.channels.map((x) => ({
                    value: x.id,
                    label: x.name,
                  })),
                types: "public_channel",
              },
            },
            text: {
              description: "Message text",
              example: "Deploy completed",
            },
          },
        });

      const meta = postMessage[TW.Meta];
      expect(meta.description).toEqual("Post a message to a Slack channel");
      const channelMeta = meta.input!.channel as unknown as {
        suggestions: {
          $: string;
          "*": { [ToCEL](): string };
          types: string;
        };
      };
      expect(channelMeta.suggestions.$).toBe("Slack::conversationsList");
      expect(channelMeta.suggestions["*"][ToCEL]()).toBe(
        'result.channels.map(x, {"value": x.id, "label": x.name})',
      );
      expect(channelMeta.suggestions.types).toBe("public_channel");
      expect(
        await postMessage({ channel: "C456", text: "Deploy completed" })
      ).toEqual({
        channel: { id: "C456", name: "engineering" },
        text: "Deploy completed",
      });
    });

    test("groups TW.Actions by service name under this.actions.<service>.<method>", async () => {
      // ── build a real TW.Action from a service actor ───────────────────────

      const { notify } = Actor("Notifier")
        .actor()
        .on("Command", "notify")

        .input({ message: "string" })

        .run(function () {
          return `sent: ${this.input.message}`;
        });

      const { Notifier } = Actor("Notifier").actor().service({ notify });

      // ── inject into a consumer actor ──────────────────────────────────────

      const { run } = Actor("Consumer")
        .use(Notifier)
        .actor()
        .on("Command", "run")

        .input({ text: "string" })

        .run(
          Step("notify", function () {
            // Type-check: this.actions.notifier.notify must be typed as the action run function
            type Check = Expect<
              Equal<typeof this.actions.notifier.notify, typeof notify.run>
            >;
            return this.actions.notifier.notify({ message: this.input.text });
          })
        );

      expect(await run({ text: "hello" })).toEqual("sent: hello");
    });

    test("exports lowercase actor factory and builds public service objects", async () => {
      const { runSteps } = Actor("MyActor")
        .actor()
        .on("Command", "runSteps")

        .input({ message: "string" })

        .run(
          Step("firstStep", function () {
            return "step 1";
          }),

          Step("lastStep", function () {
            return this.firstStep.length;
          })
        );

      const { MyActor } = Actor("MyActor").actor().service({ runSteps });

      expect(await MyActor.runSteps({ message: "hello" })).toEqual(6);

      const { run } = Actor("Consumer")
        .use(MyActor)
        .actor()
        .on("Command", "run")

        .input({ message: "string" })

        .run(
          Step("runSteps", function () {
            type Check = Expect<
              Equal<typeof this.actions.myActor.runSteps, typeof runSteps.run>
            >;
            return this.actions.myActor.runSteps({
              message: this.input.message,
            });
          })
        );

      expect(await run({ message: "hello" })).toEqual(6);
    });

    test("service exposes public actions directly", async () => {
      const { actor } = Actor("Greeter");

      const { greet } = actor()
        .on("Command", "greet")

        .input({ name: "string" })

        .run(
          Step("salutation", function () {
            return "Hello";
          }),

          Step("greet", function () {
            return `${this.salutation} ${this.input.name}.`;
          })
        );

      const { Greeter } = actor().service({ greet });

      type ActionCheck = Expect<Equal<typeof Greeter.greet, typeof greet>>;

      type StreamCheck = Expect<
        typeof Greeter.greet.stream extends (input: {
          name: string;
        }) => AsyncGenerator<
          TW.ActionEvent<"Greeter::greet", string, { name: string }>,
          string
        >
          ? true
          : false
      >;

      expect(await Greeter.greet({ name: "Ada" })).toEqual("Hello Ada.");

      const streamed: unknown[] = [];
      for await (const event of Greeter.greet.stream({ name: "Lin" })) {
        streamed.push(event);
      }

      expect(eventDataList(streamed)).toEqual([
        { ">>": "Greeter::greet", input: { name: "Lin" } },
        { ">>": "Greeter::greet.salutation", result: "Hello" },
        { ">>": "Greeter::greet.greet", result: "Hello Lin." },
        { ">>": "Greeter::greet", result: "Hello Lin." },
      ]);
    });

    test("same actor command can be injected with .use() on a second command", async () => {
      const { actor } = Actor("Slack");

      const { conversationsList } = actor()
        .on("Command", "conversationsList")

        .input({ types: "string" })

        .run(function () {
          return {
            channels:
              this.input.types === "public_channel"
                ? [{ id: "C123", name: "general" }]
                : [],
          };
        });

      const { Slack } = actor().service({ conversationsList });

      const { postMessage } = actor()
        .on("Command", "postMessage")

        .use(Slack)

        .input({ channel: "string", text: "string" })

        .run(
          Step("channels", async function () {
            type Check = Expect<
              Equal<
                typeof this.actions.slack.conversationsList,
                typeof conversationsList.run
              >
            >;
            return await this.actions.slack.conversationsList({
              types: "public_channel",
            });
          }),

          Step("message", function () {
            const selected = this.channels.channels.find(
              (item) => item.id === this.input.channel
            );
            return {
              channel: selected,
              text: this.input.text,
            };
          })
        );

      expect(await postMessage({ channel: "C123", text: "hello" })).toEqual({
        channel: { id: "C123", name: "general" },
        text: "hello",
      });
    });

    test("same actor command can be injected with .use() on the actor instance", async () => {
      const { actor } = Actor("Slack");

      const { conversationsList } = actor()
        .on("Command", "conversationsList")

        .input({ types: "string" })

        .run(function () {
          return [`channels:${this.input.types}`];
        });

      const { Slack } = actor().service({ conversationsList });

      const { postMessage } = actor()
        .use(Slack)

        .on("Command", "postMessage")

        .input({ text: "string" })

        .run(
          Step("channels", function () {
            type Check = Expect<
              Equal<
                typeof this.actions.slack.conversationsList,
                typeof conversationsList.run
              >
            >;
            return this.actions.slack.conversationsList({
              types: "public_channel",
            });
          }),

          Step("message", function () {
            return `${this.input.text} via ${this.channels[0]}`;
          })
        );

      expect(await postMessage({ text: "hello" })).toEqual(
        "hello via channels:public_channel"
      );
    });

    test("merges actions from variadic .use() preserving every service", async () => {
      const { sendEmail } = Actor("Emailer")
        .actor()

        .on("Command", "sendEmail")

        .input({ to: "string" })

        .run(function () {
          return `email→${this.input.to}`;
        });
      const { Emailer } = Actor("Emailer").actor().service({ sendEmail });

      const { sendText } = Actor("Texter")
        .actor()

        .on("Command", "sendText")

        .input({ to: "string" })

        .run(function () {
          return `text→${this.input.to}`;
        });

      const { Texter } = Actor("Texter").actor().service({ sendText });

      const { dispatch } = Actor("Dispatcher")
        .use(Emailer, Texter)
        .actor()
        .on("Command", "dispatch")

        .input({ recipient: "string" })

        .run(
          Step("email", function () {
            return this.actions.emailer.sendEmail({
              to: this.input.recipient,
            });
          }),

          Step("text", function () {
            return this.actions.texter.sendText({
              to: this.input.recipient,
            });
          }),

          Step("message", function () {
            return `${this.email} | ${this.text}`;
          })
        );

      expect(await dispatch({ recipient: "alice" })).toEqual(
        "email→alice | text→alice"
      );
    });

    test("bare TW.Action (no wrapping object) — use(notify) equivalent to use({ notify })", async () => {
      const { notify } = Actor("Notifier")
        .actor()
        .on("Command", "notify")

        .input({ message: "string" })

        .run(function () {
          return `sent: ${this.input.message}`;
        });

      // Pass the action directly instead of wrapping it

      const { run } = Actor("Consumer")
        .use(notify)
        .actor()
        .on("Command", "run")

        .input({ text: "string" })

        .run(
          Step("notify", function () {
            type Check = Expect<
              Equal<typeof this.actions.notifier.notify, typeof notify.run>
            >;
            return this.actions.notifier.notify({ message: this.input.text });
          })
        );

      expect(await run({ text: "hello" })).toEqual("sent: hello");
    });

    test("bare TW.Action — lowercase actor factory works after use(notify)", async () => {
      const { notify } = Actor("Notifier")
        .actor()
        .on("Command", "notify")

        .input({ message: "string" })

        .run(function () {
          return `bare: ${this.input.message}`;
        });

      // Destructure the actor name directly from the .use() result

      const { run } = Actor("Consumer")
        .use(notify)
        .actor()
        .on("Command", "run")

        .input({ text: "string" })

        .run(
          Step("notify", function () {
            return this.actions.notifier.notify({ message: this.input.text });
          })
        );

      expect(await run({ text: "world" })).toEqual("bare: world");
    });

    test("bare Action (no Actor) — use(action) injects directly as this.actions.<name>", async () => {
      // Flat name: TW.Name = "notify" → this.actions.notify run
      const { notify } = Action("notify")
        .input({ message: "string" })

        .run(function () {
          return `sent: ${this.input.message}`;
        });

      const { actor } = Actor("Consumer").use(notify);

      const { run } = actor()
        .on("Command", "run")

        .input({ text: "string" })

        .run(
          Step("notify", function () {
            type Check = Expect<
              Equal<typeof this.actions.notify, typeof notify.run>
            >;
            return this.actions.notify({ message: this.input.text });
          })
        );

      expect(await run({ text: "hello" })).toEqual("sent: hello");
    });

    test("bare Action — use({ action }) object form also works", async () => {
      const { notify } = Action("notify")
        .input({ message: "string" })

        .run(function () {
          return `sent: ${this.input.message}`;
        });

      const { actor } = Actor("Consumer").use({ notify });

      const { run } = actor()
        .on("Command", "run")

        .input({ text: "string" })

        .run(
          Step("notify", function () {
            return this.actions.notify({ message: this.input.text });
          })
        );

      expect(await run({ text: "world" })).toEqual("sent: world");
    });

    test("non-TW.Action values in .use() object are silently ignored", async () => {
      // Plain object with a mix of action and non-action values

      const { ping } = Actor("Pinger")
        .actor()
        .on("Command", "ping")

        .run(function () {
          return "pong";
        });

      // notAnAction is a plain function without [TW.Name] → should be skipped
      const callerBuilder = Actor("Caller").use({
        ping,
        notAnAction: () => "ignored",
      });

      const { run } = callerBuilder
        .actor()
        .on("Command", "run")

        .run(
          Step("ping", function () {
            return this.actions.pinger.ping();
          })
        );

      expect(await run()).toEqual("pong");
      // `notAnAction` must NOT appear in actions scope at the type level
      type actions = typeof run extends TW.Action<any, any>
        ? never // prevents unused-type-param error
        : never;
      type Check = "notAnAction" extends keyof (typeof callerBuilder extends {
        actor: () => infer B;
      }
        ? B
        : never)
        ? false
        : true;
    });
  });

  // ── Trait implementation ─────────────────────────────────────────────────────

  describe("trait implementation", () => {
    test("actor implements trait — input type inferred from trait instance", async () => {
      const Logger = Trait<{ log: (input: string) => string }>();

      const { actor } = Actor("S3Logger");

      const { log } = actor()
        .on(Logger.log)

        .run(function () {
          return `s3: ${this.input}`;
        });

      // Runtime behaviour
      expect(await log("hello")).toEqual("s3: hello");

      // TW.Name is the actor-qualified name
      expect((log as any)[TW.Name]).toBe("S3Logger::log");

      // TW.Meta carries the trait reference
      expect((log as any)[TW.Meta]).toEqual({ trait: "::log" });

      // Type: keyed by method name, qualified action name, trait meta
      type check = Expect<
        Equal<
          typeof log,
          TW.Action<
            "S3Logger::log",
            (input: string) => Promise<string>,
            { trait: "::log" }
          >
        >
      >;
    });

    test("actor implements trait — no-arg method produces no-arg action", async () => {
      const Logger = Trait<{ log: () => string }>();

      const { actor } = Actor("S3Logger");

      const { log } = actor()
        .on(Logger.log)

        .run(function () {
          return "logged";
        });

      expect(await log()).toEqual("logged");
      expect((log as any)[TW.Name]).toBe("S3Logger::log");
      expect((log as any)[TW.Meta]).toEqual({ trait: "::log" });

      type check = Expect<
        Equal<
          typeof log,
          TW.Action<"S3Logger::log", () => Promise<string>, { trait: "::log" }>
        >
      >;
    });

    test("actor implements trait event — on-method maps to event action", async () => {
      const VoiceCall = Trait<{
        onVoiceCall: (
          chunk: ArrayBuffer
        ) => Generator<ArrayBuffer, null, unknown>;
      }>();

      const { actor } = Actor("Assistant");

      const { onVoiceCall } = actor()
        .on(VoiceCall.VoiceCall)

        .run(function () {
          return this.input.byteLength;
        });

      expect(await onVoiceCall(new ArrayBuffer(4))).toEqual(4);
      expect((onVoiceCall as any)[TW.Name]).toBe("Assistant::onVoiceCall");
      expect((onVoiceCall as any)[TW.Meta]).toEqual({
        event: "::VoiceCall",
      });

      type check = Expect<
        Equal<
          typeof onVoiceCall,
          TW.Action<
            "Assistant::onVoiceCall",
            (input: ArrayBuffer) => Promise<number>,
            { event: "::VoiceCall" }
          >
        >
      >;
    });

    test("actor use trait — trait actions are added directly to actions scope", () => {
      const Logger = Trait<{ log: () => string }>();

      const { actor } = Actor("S3Logger").use(Logger);

      const { smth } = actor()
        .on("Command", "smth")

        .run(function () {
          return this.actions.log;
        });

      type check = Expect<
        Equal<Awaited<ReturnType<typeof smth>>, typeof Logger.log.run>
      >;
    });

    test("actor implements trait — multiple methods, input inferred per method", async () => {
      const Storage = Trait<{
        read: (input: string) => string;
        write: (input: { key: string; value: string }) => string;
      }>();

      const { actor } = Actor("S3Storage");

      const { read } = actor()
        .on(Storage.read)

        .run(function () {
          return `data:${this.input}`;
        });

      const { write } = actor()
        .on(Storage.write)

        .run(function () {
          return `wrote:${this.input.key}`;
        });

      expect(await read("k")).toEqual("data:k");
      expect(await write({ key: "k", value: "v" })).toEqual("wrote:k");

      expect((read as any)[TW.Name]).toBe("S3Storage::read");
      expect((write as any)[TW.Name]).toBe("S3Storage::write");
      expect((read as any)[TW.Meta]).toEqual({ trait: "::read" });
      expect((write as any)[TW.Meta]).toEqual({ trait: "::write" });

      type checkRead = Expect<
        Equal<
          typeof read,
          TW.Action<
            "S3Storage::read",
            (input: string) => Promise<string>,
            { trait: "::read" }
          >
        >
      >;
      type checkWrite = Expect<
        Equal<
          typeof write,
          TW.Action<
            "S3Storage::write",
            (input: { key: string; value: string }) => Promise<string>,
            { trait: "::write" }
          >
        >
      >;
    });
  });
});
