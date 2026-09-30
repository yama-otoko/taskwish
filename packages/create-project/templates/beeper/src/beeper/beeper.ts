import { Actor } from "taskwish";

export const { actor } = Actor("Beeper");

const DEFAULT_BEEPER_API_URL = "http://127.0.0.1:23373";

export type BeeperMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function beeperRequest(
  method: BeeperMethod,
  path: string,
  options: {
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
  } = {},
): Promise<unknown> {
  const token = process.env.BEEPER_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "BEEPER_ACCESS_TOKEN is required. Create one in Beeper Desktop under Settings > Integrations > Developer API.",
    );
  }

  const normalizedPath = normalizeBeeperPath(path);
  const baseURL = new URL(
    process.env.BEEPER_API_URL ?? DEFAULT_BEEPER_API_URL,
  );
  if (baseURL.protocol !== "http:" && baseURL.protocol !== "https:") {
    throw new Error("BEEPER_API_URL must use HTTP or HTTPS.");
  }

  const url = new URL(normalizedPath, ensureTrailingSlash(baseURL));
  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    body:
      options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const result = text ? parseResponse(text, response) : null;
  if (!response.ok) {
    throw new Error(
      `Beeper API ${method} ${normalizedPath} failed (${response.status}): ${errorMessage(result)}`,
    );
  }
  return result;
}

export function encodePathSegment(value: string): string {
  if (!value.trim()) throw new Error("Beeper resource IDs cannot be empty.");
  return encodeURIComponent(value);
}

export function parseJsonObject(
  value: string | undefined,
  field: string,
): Record<string, unknown> {
  if (!value?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${field} must be valid JSON.`);
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`${field} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function normalizeBeeperPath(path: string): string {
  const normalized = path.trim().replace(/^\/+/, "");
  if (!normalized.startsWith("v1/") && normalized !== "v1") {
    throw new Error("path must stay inside Beeper's versioned /v1 API.");
  }
  if (normalized.split("/").some((part) => part === "..")) {
    throw new Error("path cannot contain parent-directory segments.");
  }
  return normalized;
}

function ensureTrailingSlash(url: URL): URL {
  const copy = new URL(url);
  if (!copy.pathname.endsWith("/")) copy.pathname += "/";
  return copy;
}

function parseResponse(text: string, response: Response): unknown {
  if (response.headers.get("content-type")?.includes("application/json")) {
    return JSON.parse(text) as unknown;
  }
  return text;
}

function errorMessage(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const body = result as Record<string, unknown>;
    const message = body.error ?? body.message ?? body.detail;
    if (typeof message === "string") return message;
  }
  return "unknown error";
}
