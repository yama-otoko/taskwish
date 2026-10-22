import jsep from "jsep";
import {
  and,
  eq,
  getTableColumns,
  gt,
  gte,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  not,
  or,
  sql,
  type SQL,
  type SQLWrapper,
  type Table,
} from "drizzle-orm";

declare const WhereFieldTag: unique symbol;

/** A table value as it appears inside a symbolic where callback. */
export type WhereField<Value> = NonNullable<Value> extends Date
  ? number & { readonly [WhereFieldTag]: Value }
  : NonNullable<Value> & { readonly [WhereFieldTag]: Value };

/** Symbolic fields inferred from a Drizzle table's select model. */
export type WhereFields<TTable extends Table> = {
  [Key in keyof TTable["$inferSelect"]]: WhereField<
    TTable["$inferSelect"][Key]
  >;
};

export type WherePredicate<TTable extends Table> = (
  fields: WhereFields<TTable>,
) => boolean;

export type SymbolicSource = Table | string;

type Value = SQLWrapper | string | number | boolean | bigint | null;

type Binding = {
  field: string;
  local: string;
};

type FunctionExpression = {
  parameter?: string;
  bindings?: Binding[];
  body: string;
};

/**
 * Convert a JavaScript-looking predicate into a Drizzle SQL expression.
 *
 * @example
 * db.select().from(users).where(
 *   where(users, ({ minimumAge, age }) => age >= minimumAge),
 * );
 */
export function where<TTable extends Table>(
  table: TTable,
  predicate: WherePredicate<TTable>,
): SQL {
  const columns = getTableColumns(table);
  const expression = extractFunctionExpression(predicate);
  const fields = new Map<string, SQLWrapper>();

  if (expression.bindings) {
    for (const { field, local } of expression.bindings) {
      const column = columns[field];
      if (!column) throw new Error(`Unknown Drizzle field "${field}"`);
      fields.set(local, column);
    }
  }

  const value = astToSql(jsep(expression.body), {
    columns,
    fields,
    parameter: expression.parameter,
  });

  if (!isSqlWrapper(value)) {
    throw new Error("Drizzle where callbacks must produce a SQL expression");
  }

  return sql`${value}`;
}

/** @internal Wrap a Drizzle database with symbolic string-based selects. */
export function wrapDatabase<TDatabase extends object>(
  database: TDatabase,
): TDatabase {
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property !== "select" && property !== "selectDistinct") {
        return Reflect.get(target, property, receiver);
      }

      const select = Reflect.get(target, property, target);
      if (typeof select !== "function") return select;

      return (...args: unknown[]) => {
        const builder = select.apply(target, args);
        return wrapFromBuilder(database, builder);
      };
    },
  });
}

function wrapFromBuilder(database: object, builder: object): object {
  return new Proxy(builder, {
    get(target, property, receiver) {
      if (property !== "from") return Reflect.get(target, property, receiver);
      const from = Reflect.get(target, property, target);

      return (source: SymbolicSource) => {
        const table = resolveTable(database, source);
        const query = from.call(target, table);
        return wrapQuery(query, table);
      };
    },
  });
}

function wrapQuery(query: object, table: Table): object {
  return new Proxy(query, {
    get(target, property, receiver) {
      const member = Reflect.get(target, property, target);
      if (typeof member !== "function") return member;

      if (property === "where") {
        return (predicate: WherePredicate<Table> | SQL | undefined) => {
          const condition =
            typeof predicate === "function"
              ? where(table, predicate)
              : predicate;
          const result = member.call(target, condition);
          return result === target ? receiver : result;
        };
      }

      return (...args: unknown[]) => {
        const result = member.apply(target, args);
        return result === target ? receiver : result;
      };
    },
  });
}

function resolveTable(database: object, source: SymbolicSource): Table {
  if (typeof source !== "string") return source;

  const metadata = Reflect.get(database, "_") as
    | { fullSchema?: Record<string, unknown> }
    | undefined;
  const table = metadata?.fullSchema?.[source];
  if (!table || typeof table !== "object") {
    throw new Error(
      `Unknown Drizzle table "${source}". Pass it through Drizzle's schema option.`,
    );
  }
  return table as Table;
}

function extractFunctionExpression(callback: Function): FunctionExpression {
  const source = callback.toString().trim();
  const arrowIndex = source.indexOf("=>");
  let parameterSource: string;
  let bodySource: string;

  if (arrowIndex !== -1) {
    parameterSource = source.slice(0, arrowIndex).trim();
    bodySource = source.slice(arrowIndex + 2).trim();
  } else {
    const match = source.match(
      /^(?:async\s+)?function(?:\s+\w+)?\s*\(([^)]*)\)\s*(\{[\s\S]*\})$/,
    );
    if (!match) {
      throw new Error(`Cannot extract a Drizzle expression from: ${source}`);
    }
    parameterSource = match[1];
    bodySource = match[2];
  }

  const parameter = stripOuterParens(parameterSource.trim());
  const body = normalizeFunctionBody(bodySource);
  if (!body) throw new Error("Drizzle where callbacks cannot be empty");

  if (/^[A-Za-z_$][\w$]*$/.test(parameter)) {
    return { parameter, body };
  }

  if (parameter.startsWith("{") && parameter.endsWith("}")) {
    return { bindings: parseBindings(parameter), body };
  }

  throw new Error(
    "Drizzle where callbacks must have one identifier or object-destructured parameter",
  );
}

function parseBindings(parameter: string): Binding[] {
  const entries = parameter.slice(1, -1).split(",");
  const bindings: Binding[] = [];

  for (const rawEntry of entries) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const match = entry.match(
      /^([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?$/,
    );
    if (!match) {
      throw new Error(
        "Drizzle where destructuring only supports field names and aliases",
      );
    }
    bindings.push({ field: match[1], local: match[2] ?? match[1] });
  }

  return bindings;
}

function normalizeFunctionBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{")) return stripOuterParens(trimmed);

  const match = trimmed.match(/^\{\s*return\s+([\s\S]*?);?\s*\}$/);
  if (!match) {
    throw new Error("Drizzle where blocks must return a single expression");
  }
  return stripOuterParens(match[1].trim());
}

function stripOuterParens(source: string): string {
  let current = source.trim();
  while (current.startsWith("(") && current.endsWith(")")) {
    const inner = current.slice(1, -1).trim();
    if (!hasBalancedParens(inner)) break;
    current = inner;
  }
  return current;
}

function hasBalancedParens(source: string): boolean {
  let depth = 0;
  for (const character of source) {
    if (character === "(") depth++;
    if (character === ")") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

type SqlContext = {
  columns: Record<string, SQLWrapper>;
  fields: Map<string, SQLWrapper>;
  parameter?: string;
};

function astToSql(node: jsep.Expression, context: SqlContext): Value {
  switch (node.type) {
    case "Identifier":
      return identifierToSql(node as jsep.Identifier, context);
    case "Literal":
      return literalToSql(node as jsep.Literal);
    case "MemberExpression":
      return memberToSql(node as jsep.MemberExpression, context);
    case "BinaryExpression":
      return binaryToSql(node as jsep.BinaryExpression, context);
    case "UnaryExpression":
      return unaryToSql(node as jsep.UnaryExpression, context);
    default:
      throw new Error(`Unsupported Drizzle expression node "${node.type}"`);
  }
}

function identifierToSql(node: jsep.Identifier, context: SqlContext): Value {
  const field = context.fields.get(node.name);
  if (field) return field;
  if (node.name === "true") return true;
  if (node.name === "false") return false;
  if (node.name === "null") return null;
  throw new Error(`Unknown Drizzle expression identifier "${node.name}"`);
}

function literalToSql(node: jsep.Literal): Value {
  const value = node.value;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  throw new Error(`Unsupported Drizzle literal ${JSON.stringify(value)}`);
}

function memberToSql(node: jsep.MemberExpression, context: SqlContext): Value {
  if (
    !context.parameter ||
    node.object.type !== "Identifier" ||
    (node.object as jsep.Identifier).name !== context.parameter
  ) {
    throw new Error("Drizzle where member access must start at the callback parameter");
  }

  let field: string | undefined;
  if (!node.computed && node.property.type === "Identifier") {
    field = (node.property as jsep.Identifier).name;
  } else if (
    node.computed &&
    node.property.type === "Literal" &&
    typeof (node.property as jsep.Literal).value === "string"
  ) {
    field = (node.property as jsep.Literal).value as string;
  }

  if (!field || !context.columns[field]) {
    throw new Error(`Unknown Drizzle field "${field ?? ""}"`);
  }
  return context.columns[field];
}

function binaryToSql(node: jsep.BinaryExpression, context: SqlContext): SQL {
  const left = astToSql(node.left, context);
  const right = astToSql(node.right, context);

  if (node.operator === "&&") return required(and(asSql(left), asSql(right)));
  if (node.operator === "||") return required(or(asSql(left), asSql(right)));

  if (["==", "===", "!=", "!=="].includes(node.operator)) {
    const negate = node.operator === "!=" || node.operator === "!==";
    if (right === null && isSqlWrapper(left)) {
      return negate ? isNotNull(left) : isNull(left);
    }
    if (left === null && isSqlWrapper(right)) {
      return negate ? isNotNull(right) : isNull(right);
    }
    return negate ? ne(asSql(left), right) : eq(asSql(left), right);
  }

  switch (node.operator) {
    case ">":
      return gt(asSql(left), right);
    case ">=":
      return gte(asSql(left), right);
    case "<":
      return lt(asSql(left), right);
    case "<=":
      return lte(asSql(left), right);
    case "+":
    case "-":
    case "*":
    case "/":
    case "%":
      return sql`(${left} ${sql.raw(node.operator)} ${right})`;
    default:
      throw new Error(`Unsupported Drizzle binary operator "${node.operator}"`);
  }
}

function unaryToSql(node: jsep.UnaryExpression, context: SqlContext): Value {
  const argument = astToSql(node.argument, context);
  if (node.operator === "!") return not(asSql(argument));
  if (node.operator === "+") return argument;
  if (node.operator === "-") return sql`(-${argument})`;
  throw new Error(`Unsupported Drizzle unary operator "${node.operator}"`);
}

function asSql(value: Value): SQLWrapper {
  return isSqlWrapper(value) ? value : sql`${value}`;
}

function isSqlWrapper(value: Value): value is SQLWrapper {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "getSQL" in value &&
    typeof value.getSQL === "function"
  );
}

function required(value: SQL | undefined): SQL {
  if (!value) throw new Error("Drizzle where expression cannot be empty");
  return value;
}
