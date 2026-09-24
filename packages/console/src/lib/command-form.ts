import type { ConsoleInputField, ConsoleJsonSchema } from "../types";
import { sentenceFromIdentifier, uppercaseFirst } from "./console-text";
import { fileInputConfig, parseUploadedFiles } from "./file-input";

export type ActionRunResult = {
  status: number;
  ok: boolean;
  contentType: string;
  body: unknown;
  events?: ActionRunEvent[];
  streaming?: boolean;
};

export type CommandFormValues = Record<string, unknown>;
export type ListItemValue = Record<string, unknown>;
export type ActionRunEvent = {
  type: string;
  data: unknown;
  message?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function schemaType(
  schema: ConsoleJsonSchema | undefined,
): string | undefined {
  if (Array.isArray(schema?.type)) {
    return schema.type.find((value) => value !== "null");
  }
  return schema?.type;
}

export function arrayItemSchema(
  schema: ConsoleJsonSchema | undefined,
): ConsoleJsonSchema | undefined {
  return Array.isArray(schema?.items) ? schema.items[0] : schema?.items;
}

export function objectSchemaFields(
  schema: ConsoleJsonSchema | undefined,
): ConsoleInputField[] {
  if (!isRecord(schema?.properties)) return [];

  return Object.entries(schema.properties).map(([name, property]) => ({
    name,
    required: schema.required?.includes(name),
    schema: property,
    description:
      typeof property.description === "string"
        ? property.description
        : undefined,
    example: property.examples?.[0],
    defaultValue: "default" in property ? property.default : undefined,
  }));
}

export function enumValue(value: unknown): string {
  return typeof value === "string"
    ? value
    : JSON.stringify(value) ?? String(value);
}

export function listItemDefaultValue(field: ConsoleInputField): ListItemValue {
  const itemSchema = arrayItemSchema(field.schema);
  const itemType = schemaType(itemSchema);
  if (itemType === "object") {
    return Object.fromEntries(
      objectSchemaFields(itemSchema).map((property) => [
        property.name,
        rawFieldDefaultValue(property),
      ]),
    );
  }
  if (itemType === "boolean") return { value: false };
  return { value: "" };
}

function rawFieldDefaultValue(field: ConsoleInputField): unknown {
  if (field.defaultValue !== undefined) return field.defaultValue;

  const type = schemaType(field.schema);
  if (type === "boolean") return false;
  if (type === "array") return [];
  return "";
}

function fieldFormDefaultValue(field: ConsoleInputField): unknown {
  const file = fileInputConfig(field);
  if (file) return file.multiple ? [] : null;
  const type = schemaType(field.schema);
  const rawValue = rawFieldDefaultValue(field);

  if (type !== "array") return rawValue;

  const values = Array.isArray(rawValue) ? rawValue : [];
  return values.map((value) => {
    if (schemaType(arrayItemSchema(field.schema)) === "object") {
      return isRecord(value) ? value : listItemDefaultValue(field);
    }
    return {
      value:
        typeof value === "object" && value !== null
          ? JSON.stringify(value, null, 2)
          : value,
    };
  });
}

export function formDefaultValues(
  fields: ConsoleInputField[],
): CommandFormValues {
  return Object.fromEntries(
    fields.map((field) => [field.name, fieldFormDefaultValue(field)]),
  );
}

function isJsonField(field: ConsoleInputField): boolean {
  const type = schemaType(field.schema);
  return type === "object" || type === "array" || !type;
}

export function fieldPlaceholder(field: ConsoleInputField): string {
  const type = schemaType(field.schema);
  if (field.example !== undefined) {
    const placeholder =
      typeof field.example === "string"
        ? field.example
        : JSON.stringify(field.example) ?? String(field.example);
    return uppercaseFirst(placeholder);
  }
  if (type === "number" || type === "integer") return "0";
  if (type === "boolean") return "";
  if (type === "string") return sentenceFromIdentifier(field.name);
  return "JSON";
}

function parseJsonValue(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function parseFieldValue(field: ConsoleInputField, value: unknown): unknown {
  const type = schemaType(field.schema);
  const raw = String(value ?? "");
  const trimmed = raw.trim();
  const enumValues = field.schema?.enum;

  if (type === "boolean") return Boolean(value);
  if (!trimmed) return undefined;

  if (Array.isArray(enumValues)) {
    const enumValueMatch = enumValues.find((item) => enumValue(item) === raw);
    if (enumValueMatch !== undefined) return enumValueMatch;
  }

  if (type === "number" || type === "integer") {
    const parsed = Number(trimmed);
    if (Number.isNaN(parsed)) {
      throw new Error(`${field.name} must be a number`);
    }
    return parsed;
  }

  if (type === "string") return raw;

  if (isJsonField(field)) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error(`${field.name} must be valid JSON`);
    }
  }

  return parseJsonValue(raw);
}

function parseListItemValue(field: ConsoleInputField, value: unknown): unknown {
  const itemSchema = arrayItemSchema(field.schema);
  if (schemaType(itemSchema) === "object") {
    const row = isRecord(value) ? value : {};
    const parsedRow: Record<string, unknown> = {};

    for (const property of objectSchemaFields(itemSchema)) {
      const parsed = parseFieldValue(property, row[property.name]);
      if (parsed !== undefined) parsedRow[property.name] = parsed;
    }

    return Object.keys(parsedRow).length ? parsedRow : undefined;
  }

  const itemField: ConsoleInputField = {
    ...field,
    schema: itemSchema,
  };
  return parseFieldValue(itemField, value);
}

function parseListValue(
  field: ConsoleInputField,
  value: unknown,
): unknown[] | undefined {
  const rows = Array.isArray(value) ? value : [];
  const parsedRows = rows
    .map((row) => (isRecord(row) && "value" in row ? row.value : row))
    .map((row) => parseListItemValue(field, row))
    .filter((row) => row !== undefined);

  if (field.required) return parsedRows;
  return parsedRows.length ? parsedRows : undefined;
}

function parseCommandFieldValue(
  field: ConsoleInputField,
  value: unknown,
): unknown {
  if (fileInputConfig(field)) return parseUploadedFiles(field, value);
  return schemaType(field.schema) === "array"
    ? parseListValue(field, value)
    : parseFieldValue(field, value);
}

export function buildPayload(
  values: CommandFormValues,
  fields: ConsoleInputField[],
) {
  if (fields.length === 1 && fields[0]?.name === "input") {
    const parsed = parseCommandFieldValue(fields[0], values.input);
    return parsed === undefined ? {} : parsed;
  }

  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    const parsed = parseCommandFieldValue(field, values[field.name]);
    if (parsed !== undefined) payload[field.name] = parsed;
  }
  return payload;
}

export function buildChatPayload(
  message: string,
  fields: ConsoleInputField[],
  sessionId?: string,
): unknown {
  const content = message.trim();
  if (!fields.length) return { sessionId, content };

  const preferredField =
    fields.find((field) =>
      ["prompt", "message", "content", "text", "input"].includes(field.name),
    ) ?? (fields.length === 1 ? fields[0] : undefined);

  if (!preferredField) return { sessionId, content };
  if (fields.length === 1 && preferredField.name === "input") return content;
  return {
    ...(sessionId ? { sessionId } : {}),
    [preferredField.name]: content,
  };
}

function parseSseData(value: string): unknown {
  if (!value) return "";
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function windLogData(eventType: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const data = value as Record<string, unknown>;
  if (eventType === "TW::Trace" && typeof data.path === "string") {
    const { path, ...params } = data;
    return { ">>": path, ...params };
  }

  if (eventType === "TW::Signal" && typeof data.event === "string") {
    const { event, ...params } = data;
    return { "->": event, ...params };
  }

  return value;
}

function appendEventBody(currentBody: unknown, event: ActionRunEvent): unknown {
  if (event.type === "yield") {
    const chunk =
      typeof event.data === "string"
        ? event.data
        : JSON.stringify(event.data) ?? String(event.data);
    return `${typeof currentBody === "string" ? currentBody : ""}${chunk}`;
  }

  return currentBody;
}

function parseSseMessage(message: string): ActionRunEvent | null {
  let eventType = "message";
  const data: string[] = [];

  for (const line of message.split("\n")) {
    if (line.startsWith("event:")) {
      eventType = line.slice("event:".length).trim() || eventType;
    } else if (line.startsWith("data:")) {
      data.push(line.slice("data:".length).replace(/^ /, ""));
    }
  }

  if (!data.length) return null;
  const normalizedType: Record<string, string> = {
    "TW::Stream": "yield",
    "TW::Trace": "wind",
    "TW::Signal": "wind",
    "TW::StateChange": "state-change",
    "TW::StateResult": "state",
    "TW::Result": "result",
    "TW::Error": "error",
  };
  const acpMessage = eventType.startsWith("ACP::") ? eventType : undefined;

  return {
    type: acpMessage ? "acp" : normalizedType[eventType] ?? eventType,
    data: windLogData(eventType, parseSseData(data.join("\n"))),
    ...(acpMessage ? { message: acpMessage } : {}),
  };
}

function actionRunResultSnapshot(result: ActionRunResult): ActionRunResult {
  return {
    ...result,
    events: result.events ? [...result.events] : undefined,
  };
}

async function* streamSseResponse(
  response: Response,
): AsyncGenerator<ActionRunResult> {
  const contentType = response.headers.get("Content-Type") ?? "";
  const result: ActionRunResult = {
    status: response.status,
    ok: response.ok,
    contentType,
    body: "",
    events: [],
    streaming: true,
  };
  yield actionRunResultSnapshot(result);

  if (!response.body) {
    result.streaming = false;
    yield actionRunResultSnapshot(result);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  const publish = (event: ActionRunEvent): ActionRunResult => {
    result.events!.push(event);
    result.body = appendEventBody(result.body, event);
    return actionRunResultSnapshot(result);
  };

  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done });

    let separatorIndex = pending.search(/\n\n/);
    while (separatorIndex !== -1) {
      const rawMessage = pending.slice(0, separatorIndex);
      pending = pending.slice(separatorIndex + 2);
      const event = parseSseMessage(rawMessage);
      if (event) yield publish(event);
      separatorIndex = pending.search(/\n\n/);
    }

    if (done) break;
  }

  const remaining = pending.trim();
  if (remaining) {
    const event = parseSseMessage(remaining);
    if (event) yield publish(event);
  }

  result.streaming = false;
  yield actionRunResultSnapshot(result);
}

export async function* streamActionResponse(
  response: Response,
): AsyncGenerator<ActionRunResult> {
  const contentType = response.headers.get("Content-Type") ?? "";

  if (contentType.includes("text/event-stream")) {
    yield* streamSseResponse(response);
    return;
  }

  const body =
    response.status === 204
      ? null
      : contentType.includes("application/json")
      ? await response.json()
      : await response.text();

  yield {
    status: response.status,
    ok: response.ok,
    contentType,
    body,
  };
}

export async function parseActionResponse(
  response: Response,
): Promise<ActionRunResult> {
  let result: ActionRunResult | undefined;

  for await (const update of streamActionResponse(response)) {
    result = update;
  }

  return (
    result ?? {
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get("Content-Type") ?? "",
      body: null,
    }
  );
}

export function formatActionResultBody(body: unknown): string {
  if (body === null) return "null";
  if (body === undefined) return "";
  if (typeof body === "string") return body;
  return JSON.stringify(body, null, 2);
}

export function formatActionRunEvents(events: ActionRunEvent[]): string {
  let output = "";

  for (const event of events) {
    if (event.type === "yield") {
      output +=
        typeof event.data === "string"
          ? event.data
          : JSON.stringify(event.data, null, 2) ?? String(event.data);
      continue;
    }

    if (output && !output.endsWith("\n")) output += "\n";
    const label = event.type === "wind" ? "wind" : event.type;
    const data =
      typeof event.data === "string"
        ? event.data
        : JSON.stringify(event.data, null, 2) ?? String(event.data);
    output += `[${label}] ${data}\n`;
  }

  return output;
}
