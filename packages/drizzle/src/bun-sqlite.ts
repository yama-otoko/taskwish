import type { Database } from "bun:sqlite";
import {
  drizzle as drizzleBase,
  type BunSQLiteDatabase,
  type DrizzleBunSqliteDatabaseConfig,
} from "drizzle-orm/bun-sqlite";
import type {
  SelectedFields,
  SQLiteSelectBase,
  SQLiteSelectBuilder,
  SQLiteSelectWithout,
  SQLiteTable,
} from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import type { DrizzleConfig } from "drizzle-orm/utils";

import {
  wrapDatabase,
  type WherePredicate,
} from "./index";

type TableName<TSchema> = {
  [Key in keyof TSchema & string]: TSchema[Key] extends SQLiteTable
    ? Key
    : never;
}[keyof TSchema & string];

type SchemaTable<
  TSchema,
  Name extends TableName<TSchema>,
> = Extract<TSchema[Name], SQLiteTable>;

type Selection<
  TTable extends SQLiteTable,
  TSelected extends SelectedFields | undefined,
> = TSelected extends SelectedFields ? TSelected : TTable["_"]["columns"];

type SelectMode<TSelected extends SelectedFields | undefined> =
  TSelected extends SelectedFields ? "partial" : "single";

type NativeQuery<
  TTable extends SQLiteTable,
  TSelected extends SelectedFields | undefined,
> = SQLiteSelectBase<
  TTable["_"]["name"],
  "sync",
  void,
  Selection<TTable, TSelected>,
  SelectMode<TSelected>
>;

export type SymbolicSQLiteQuery<
  TTable extends SQLiteTable,
  TSelected extends SelectedFields | undefined,
> = Omit<NativeQuery<TTable, TSelected>, "where"> & {
  where(
    predicate: WherePredicate<TTable> | SQL | undefined,
  ): SQLiteSelectWithout<NativeQuery<TTable, TSelected>, false, "where">;
};

export type SymbolicSQLiteSelectBuilder<
  TSchema extends Record<string, unknown>,
  TSelected extends SelectedFields | undefined,
> = Omit<SQLiteSelectBuilder<TSelected, "sync", void>, "from"> & {
  from<Name extends TableName<TSchema>>(
    table: Name,
  ): SymbolicSQLiteQuery<SchemaTable<TSchema, Name>, TSelected>;
};

export type SymbolicBunSQLiteDatabase<
  TSchema extends Record<string, unknown>,
  TClient extends Database = Database,
> = Omit<
  BunSQLiteDatabase<TSchema> & { $client: TClient },
  "select" | "selectDistinct"
> & {
  select(): SymbolicSQLiteSelectBuilder<TSchema, undefined>;
  select<TSelection extends SelectedFields>(
    fields: TSelection,
  ): SymbolicSQLiteSelectBuilder<TSchema, TSelection>;
  selectDistinct(): SymbolicSQLiteSelectBuilder<TSchema, undefined>;
  selectDistinct<TSelection extends SelectedFields>(
    fields: TSelection,
  ): SymbolicSQLiteSelectBuilder<TSchema, TSelection>;
};

type BunDrizzleParameters<
  TSchema extends Record<string, unknown>,
  TClient extends Database,
> =
  | []
  | [TClient | string]
  | [TClient | string, DrizzleConfig<TSchema>]
  | [
      DrizzleConfig<TSchema> &
        (
          | { connection?: DrizzleBunSqliteDatabaseConfig }
          | { client: TClient }
        ),
    ];

/** Create a Bun SQLite database with typed string tables and symbolic where callbacks. */
export function drizzle<
  TSchema extends Record<string, unknown> = Record<string, never>,
  TClient extends Database = Database,
>(
  ...params: BunDrizzleParameters<TSchema, TClient>
): SymbolicBunSQLiteDatabase<TSchema, TClient> {
  const database = drizzleBase<TSchema, TClient>(...params);
  return wrapDatabase(database) as unknown as SymbolicBunSQLiteDatabase<
    TSchema,
    TClient
  >;
}

export * from "drizzle-orm/bun-sqlite";
