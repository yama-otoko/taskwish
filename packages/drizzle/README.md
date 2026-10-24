# @taskwish/drizzle

Use Drizzle with typed string table names and JavaScript-looking filters. The
callback is parsed, not executed, and converted to Drizzle's SQL expression
tree.

```ts
import { drizzle } from "@taskwish/drizzle/bun-sqlite";

const db = drizzle(":memory:", { schema: { ranges } });

const rows = await db
  .select()
  .from("ranges")
  .where(({ minimum, maximum }) => maximum >= minimum);
```

The expression syntax supports `==`, `===`, `!=`, `!==`, `<`, `<=`, `>`,
`>=`, `&&`, `||`, `!`, arithmetic with `+`, `-`, `*`, `/`, `%`, literals,
and `null` comparisons. A normal parameter is also supported:

```ts
db.select()
  .from("ranges")
  .where((fields) => fields.maximum >= fields.minimum);
```

Captured JavaScript variables and function calls are intentionally not
supported because callbacks are converted from source text rather than run.
