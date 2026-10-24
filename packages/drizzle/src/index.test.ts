import { describe, expect, test } from "bun:test";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { where } from "./index";
import { drizzle } from "./bun-sqlite";

const ranges = sqliteTable("ranges", {
  id: integer("id").primaryKey(),
  minimum: integer("minimum").notNull(),
  maximum: integer("maximum").notNull(),
  label: text("label"),
});

describe("symbolic Drizzle where", () => {
  test("compares two destructured columns", () => {
    const database = drizzle(":memory:", { schema: { ranges } });
    const query = database
      .select()
      .from("ranges")
      .where(({ maximum, minimum }) => maximum >= minimum)
      .toSQL();

    expect(query.sql).toContain('"ranges"."maximum" >= "ranges"."minimum"');
    expect(query.params).toEqual([]);
  });

  test("supports arithmetic, literals, aliases, and boolean composition", () => {
    const database = drizzle(":memory:", { schema: { ranges } });
    const query = database
      .select()
      .from("ranges")
      .where(
        ({ minimum: low, maximum: high }) =>
          high >= low + 10 && high < 100,
      )
      .toSQL();

    expect(query.sql).toContain(
      '"ranges"."maximum" >= ("ranges"."minimum" + ?)',
    );
    expect(query.sql).toContain('"ranges"."maximum" < ?');
    expect(query.params).toEqual([10, 100]);
  });

  test("supports a named parameter and null comparisons", () => {
    const database = drizzle(":memory:", { schema: { ranges } });
    const query = database
      .select()
      .from("ranges")
      .where((fields) => fields.label != null)
      .toSQL();

    expect(query.sql).toContain('"ranges"."label" is not null');
    expect(query.params).toEqual([]);
  });

  test("keeps selected row types", async () => {
    const database = drizzle(":memory:", { schema: { ranges } });
    database.run(
      "create table ranges (id integer primary key, minimum integer not null, maximum integer not null, label text)",
    );
    database.run(
      "insert into ranges (minimum, maximum, label) values (10, 20, 'kept'), (30, 25, 'dropped')",
    );

    const rows = await database
      .select()
      .from("ranges")
      .where(({ maximum, minimum }) => maximum >= minimum);

    const typed: (typeof ranges.$inferSelect)[] = rows;
    expect(typed).toEqual([
      { id: 1, minimum: 10, maximum: 20, label: "kept" },
    ]);
  });

  test("keeps partial selection types", async () => {
    const database = drizzle(":memory:", { schema: { ranges } });
    database.run(
      "create table ranges (id integer primary key, minimum integer not null, maximum integer not null, label text)",
    );
    database.run(
      "insert into ranges (minimum, maximum) values (10, 20), (30, 25)",
    );

    const rows = await database
      .select({ upper: ranges.maximum })
      .from("ranges")
      .where(({ maximum, minimum }) => maximum >= minimum);

    const typed: { upper: number }[] = rows;
    expect(typed).toEqual([{ upper: 20 }]);
  });

  test("rejects identifiers outside the callback fields", () => {
    expect(() =>
      where(ranges, ({ maximum }) => maximum > missingValue),
    ).toThrow('Unknown Drizzle expression identifier "missingValue"');
  });
});

declare const missingValue: number;

function compileTimeChecks() {
  const database = drizzle(":memory:", { schema: { ranges } });

  // @ts-expect-error Only configured schema table names are accepted.
  database.select().from("missing");

  database
    .select()
    .from("ranges")
    // @ts-expect-error Callback fields are inferred from the selected table.
    .where(({ missing }) => missing > 0);
}

void compileTimeChecks;
