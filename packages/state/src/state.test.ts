import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Actor, Step, TW } from "@taskwish/core";
import { Store, State, statePayload } from "./index";

const temporaryDirectories: string[] = [];
const originalDefaultStorePath = process.env.TW_DEFAULT_STORE_PATH;

function temporaryStateDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), "taskwish-state-"));
  temporaryDirectories.push(root);
  return join(root, "state");
}

afterEach(() => {
  if (originalDefaultStorePath === undefined) {
    delete process.env.TW_DEFAULT_STORE_PATH;
  } else {
    process.env.TW_DEFAULT_STORE_PATH = originalDefaultStorePath;
  }

  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("State", () => {
  test("uses a filesystem store by default", async () => {
    const root = mkdtempSync(join(tmpdir(), "taskwish-state-"));
    temporaryDirectories.push(root);
    delete process.env.TW_DEFAULT_STORE_PATH;
    const previousDirectory = process.cwd();
    const scoped = (() => {
      process.chdir(root);
      try {
        return Actor("DefaultStore").scope(
          State({ items: State.List({ description: "string" }) })
        );
      } finally {
        process.chdir(previousDirectory);
      }
    })();

    const { add } = scoped
      .actor()

      .on("Command", "add")

      .run(function () {
        return this.state.items.push({ description: "persist me" });
      });

    await add();
    expect(
      JSON.parse(readFileSync(join(root, "state", "DefaultStore.json"), "utf8"))
    ).toEqual({ items: [{ description: "persist me" }] });
  });

  test("uses TW_DEFAULT_STORE_PATH as the default store directory", async () => {
    const directory = temporaryStateDirectory();
    process.env.TW_DEFAULT_STORE_PATH = directory;

    const { actor } = Actor("EnvironmentStore").scope(
      Store({ adapter: "fs" }),
      State({ items: State.List({ description: "string" }) })
    );
    const { add } = actor()
      .on("Command", "add")

      .run(function () {
        this.state.items.push({ description: "from env" });
      });

    await add();
    expect(
      JSON.parse(readFileSync(join(directory, "EnvironmentStore.json"), "utf8"))
    ).toEqual({ items: [{ description: "from env" }] });
  });

  test("primitive values are mutable, persisted, and reloaded", async () => {
    const directory = temporaryStateDirectory();
    const createActor = () =>
      Actor("Counter")
        .scope(Store({ adapter: "fs", directory }), State({ count: 0 }))
        .actor();

    const first = createActor();
    const { increase } = first.on("Command", "increase").run(function () {
      return ++this.state.count;
    });

    expect(await increase()).toBe(1);
    expect(
      JSON.parse(readFileSync(join(directory, "Counter.json"), "utf8"))
    ).toEqual({ count: 1 });

    const second = createActor();
    const { decrease } = second.on("Command", "decrease").run(function () {
      return --this.state.count;
    });

    expect(await decrease()).toBe(0);
  });

  test("SQLite stores actor state and reloads it", async () => {
    const root = mkdtempSync(join(tmpdir(), "taskwish-state-"));
    temporaryDirectories.push(root);
    const database = join(root, "state", "taskwish.sqlite");
    const sqliteState = () => [
      Store({ adapter: "sqlite", database }),
      State({ count: 0 }),
    ] as const;

    const first = Actor("SQLiteCounter").scope(...sqliteState()).actor();
    const { increase } = first.on("Command", "increase").run(function () {
      return ++this.state.count;
    });
    expect(await increase()).toBe(1);
    expect(await increase()).toBe(2);

    const reloaded = Actor("SQLiteCounter").scope(...sqliteState()).actor();
    const { count } = reloaded.on("Command", "count").run(function () {
      return this.state.count;
    });
    expect(await count()).toBe(2);

    const other = Actor("OtherSQLiteCounter").scope(...sqliteState()).actor();
    const { count: otherCount } = other
      .on("Command", "count")
      .run(function () {
        return this.state.count;
      });
    expect(await otherCount()).toBe(0);
  });

  test("ctx overrides state for isolated tests", async () => {
    const directory = temporaryStateDirectory();
    const { actor } = Actor("MockedCounter").scope(
      Store({ adapter: "fs", directory }),
      State({ count: 0 })
    );
    const { increase } = actor()
      .on("Command", "increase")

      .run(
        Step("increase", function () {
          return ++this.state.count;
        })
      );
    const state = { count: 40 };

    await expect(increase.ctx({ state }).run()).resolves.toBe(41);
    expect(state.count).toBe(41);
    await expect(increase()).resolves.toBe(1);
  });

  test("State.List is mutable in actor scope and persists", async () => {
    const directory = temporaryStateDirectory();
    const { actor } = Actor("Todos").scope(
      Store({ adapter: "fs", directory }),
      State({
        items: State.List({
          id: "primary.uuidv4.random",
          description: "string",
          done: "boolean",
        }),
      })
    );

    const { add } = actor()
      .on("Command", "add")
      .input({ description: "string" })
      .run(function () {
        this.state.items.push({
          description: this.input.description,
          done: false,
        });
        return this.state.items.at(-1)!.id;
      });

    const id = await add({ description: "Write the docs" });
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    const persisted = JSON.parse(
      readFileSync(join(directory, "Todos.json"), "utf8")
    );
    expect(persisted).toMatchObject({
      items: [{ description: "Write the docs", done: false }],
    });
    expect(persisted.items[0].id).toBe(id);
  });

  test("tags state values, exposes state-command metadata, and streams changes", async () => {
    const directory = temporaryStateDirectory();
    const { actor } = Actor("ActionableTodos").scope(
      Store({ adapter: "fs", directory }),
      State({
        items: State.List({ id: "string", done: "boolean" }),
      })
    );

    const { seed } = actor()
      .on("Command", "seed")
      .run(function () {
        this.state.items.push({ id: "one", done: false });
        return this.state.items;
      });
    const { complete } = actor()
      .on("Command", "complete")
      .input({ id: "string" })
      .addStateCommand("item", {
        markDone: {
          input: { id: "item.id" },
          visible: { done: false },
        },
      })
      .run(function () {
        const item = this.state.items.find(({ id }) => id === this.input.id)!;
        item.done = true;
        return item;
      });

    // oxlint-disable-next-line no-constant-condition -- This block only verifies compile-time errors.
    if (false) {
      actor()
        .on("Command", "invalidStateCommand")
        .input({ id: "string" })
        .addStateCommand("item", {
          invalid: {
            input: {
              // @ts-expect-error State command paths are checked against list item fields.
              id: "item.missing",
            },
            visible: {
              // @ts-expect-error State command conditions are checked against list item fields.
              missing: true,
            },
          },
        });
    }

    const { ActionableTodos } = actor().service({ seed, complete });
    const items = await seed();
    expect(
      (ActionableTodos as unknown as Record<symbol, any>)[TW.States].state.items
    ).toBe(items);
    expect(items[TW.State]).toBe("state.items");
    expect(
      (items[0] as (typeof items)[number] & Record<symbol, unknown>)[TW.State]
    ).toBe("state.items");
    const payload = statePayload(items);
    expect(payload?.path).toBe("state.items");
    expect(payload?.columns).toEqual(["id", "done"]);
    expect(statePayload(items.filter(() => true))?.columns).toEqual([
      "id",
      "done",
    ]);
    expect(complete[TW.Meta]).toMatchObject({
      stateCommands: {
        item: {
          markDone: {
            input: { id: "item.id" },
            visible: { done: false },
          },
        },
      },
    });

    const events: unknown[] = [];
    for await (const event of complete.stream({ id: "one" })) {
      events.push(event);
    }
    expect(events).toContainEqual(
      expect.objectContaining({
        message: "TW::StateChange",
        path: "ActionableTodos::state.items",
      })
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        message: "TW::StateChange",
        data: expect.objectContaining({
          path: "ActionableTodos::state.items",
          previous: [{ id: "one", done: false }],
          value: [{ id: "one", done: true }],
        }),
      })
    );
  });

  test("State.List validates primary.uuidv4.random fields", async () => {
    const directory = temporaryStateDirectory();
    const { actor } = Actor("UUIDs").scope(
      Store({ adapter: "fs", directory }),
      State({
        items: State.List({ id: "primary.uuidv4.random" }),
      })
    );

    const { addInvalid } = actor()
      .on("Command", "addInvalid")

      .run(function () {
        return this.state.items.push({ id: "not-a-uuid" });
      });

    await expect(addInvalid()).rejects.toThrow(
      "Invalid value at state.items[0]"
    );
  });

  test("state reloads from the store", async () => {
    const directory = temporaryStateDirectory();
    const createActor = () =>
      Actor("Reloadable")
        .scope(
          Store({ adapter: "fs", directory }),
          State({
            items: State.List({ name: "string", done: "boolean" }),
          })
        )
        .actor();

    const first = createActor();
    const { add } = first
      .on("Command", "add")

      .input({ name: "string" })

      .run(function () {
        this.state.items.push({ name: this.input.name, done: false });
      });
    await add({ name: "one" });

    const second = createActor();
    const { count } = second.on("Command", "count").run(function () {
      return this.state.items.length;
    });

    expect(await count()).toBe(1);
  });

  test("invalid list items are rejected by their schema", async () => {
    const directory = temporaryStateDirectory();
    const { actor } = Actor("Validated").scope(
      Store({ adapter: "fs", directory }),
      State({
        items: State.List({ description: "string", done: "boolean" }),
      })
    );

    const { addInvalid } = actor()
      .on("Command", "addInvalid")

      .run(function () {
        return this.state.items.push({
          description: "bad",
          // @ts-expect-error State.List infers done as boolean
          done: "no",
        });
      });

    await expect(addInvalid()).rejects.toThrow(
      "Invalid value at state.items[0]"
    );

    const { list } = actor()
      .on("Command", "list")
      .run(function () {
        return this.state.items;
      });
    expect(Array.from(await list())).toEqual([]);
  });
});
