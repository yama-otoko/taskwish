import { messageLogData } from "./messages";

const MAX_LOG_DEPTH = 3;

function fmt(val: unknown, seen: object[] = [], depth: number = 0): string {
  if (val === null) return "null";
  if (val instanceof Error) return fmt({ message: val.message });
  if (typeof val === "bigint") return `${val.toString()}n`;
  if (typeof val === "symbol") return JSON.stringify(String(val));
  if (typeof val === "function") {
    return JSON.stringify("[Function]");
  }
  if (typeof val !== "object") return JSON.stringify(val);
  if (seen.includes(val)) return JSON.stringify("[Circular]");

  const constructorName = val.constructor?.name ?? "Object";
  if (depth >= MAX_LOG_DEPTH) return JSON.stringify(`[${constructorName}]`);

  seen.push(val);

  const toJSON = (val as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === "function") {
    try {
      const jsonValue = toJSON.call(val);
      if (jsonValue !== val) {
        seen.pop();
        return fmt(jsonValue, seen, depth);
      }
    } catch {
      // Fall through to structural formatting if a custom toJSON throws.
    }
  }

  if (Array.isArray(val)) {
    const items = val.map((item) => fmt(item, seen, depth + 1));
    seen.pop();
    return items.length ? `[ ${items.join(", ")} ]` : "[]";
  }

  const entries = Object.entries(val as object)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `"${k}": ${fmt(v, seen, depth + 1)}`);
  seen.pop();
  return entries.length ? `{ ${entries.join(", ")} }` : "{}";
}

const BOLD_KEYS = new Set(["result", "error", "input"]);

export function formatEvent(event: object): string {
  const e = messageLogData(event) as Record<string, unknown>;
  const kind =
    e["~>"] !== undefined
      ? "~>"
      : e[">>"] !== undefined
      ? ">>"
      : e["=="] !== undefined
      ? "=="
      : e["->"] !== undefined
      ? "->"
      : e[":="] !== undefined
      ? ":="
      : e["=>"] !== undefined
      ? "=>"
      : "->";
  const name = e[kind];
  const entries = [`\x1b[2m"${kind}": \x1b[22m"\x1b[1m${name}\x1b[22m"`];

  for (const [k, v] of Object.entries(e)) {
    if (k === kind || v === undefined) continue;

    entries.push(
      `${BOLD_KEYS.has(k) ? `\x1b[2m"${k}": \x1b[22m` : `"${k}": `}${fmt(v)}`
    );
  }

  return `\x1b[2m{\x1b[22m ${entries.join(", ")} \x1b[2m}\x1b[22m`;
}

export function isActionEvent(name: string): boolean {
  if (name.includes("::")) return /^[A-Z][^:]*::[^.]+$/.test(name);
  const parts = name.split(".");
  return parts.length === 1 || (parts.length === 2 && /^[A-Z]/.test(parts[0]!));
}
