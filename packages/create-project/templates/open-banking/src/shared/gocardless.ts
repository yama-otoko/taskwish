const DEFAULT_BASE_URL = "https://bankaccountdata.gocardless.com/api/v2";

type JsonObject = Record<string, unknown>;

let cachedToken:
  | { access: string; expiresAt: number; credentialKey: string }
  | undefined;

export async function bankDataRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const access = await getAccessToken();
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${access}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  return readResponse<T>(response, `Bank Account Data request ${path}`);
}

export function resetBankDataTokenCache(): void {
  cachedToken = undefined;
}

async function getAccessToken(): Promise<string> {
  const secretId = process.env.GOCARDLESS_BANK_SECRET_ID?.trim();
  const secretKey = process.env.GOCARDLESS_BANK_SECRET_KEY?.trim();
  if (!secretId || !secretKey) {
    throw new Error(
      "Set GOCARDLESS_BANK_SECRET_ID and GOCARDLESS_BANK_SECRET_KEY before using OpenBanking.",
    );
  }

  const credentialKey = `${secretId}:${secretKey}`;
  if (
    cachedToken &&
    cachedToken.credentialKey === credentialKey &&
    cachedToken.expiresAt > Date.now() + 30_000
  ) {
    return cachedToken.access;
  }

  const response = await fetch(`${baseUrl()}/token/new/`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ secret_id: secretId, secret_key: secretKey }),
  });
  const token = await readResponse<JsonObject>(response, "Bank Account Data authentication");
  if (typeof token.access !== "string") {
    throw new Error("Bank Account Data authentication returned no access token.");
  }
  const lifetime =
    typeof token.access_expires === "number" ? token.access_expires : 300;
  cachedToken = {
    access: token.access,
    expiresAt: Date.now() + lifetime * 1_000,
    credentialKey,
  };
  return token.access;
}

async function readResponse<T>(response: Response, operation: string): Promise<T> {
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const detail =
      body && typeof body === "object" && "detail" in body
        ? String((body as JsonObject).detail)
        : response.statusText || "request failed";
    throw new Error(`${operation} failed (${response.status}): ${detail}`);
  }
  return body as T;
}

function baseUrl(): string {
  return (process.env.GOCARDLESS_BANK_BASE_URL ?? DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );
}
