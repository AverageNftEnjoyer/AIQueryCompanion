import { NextResponse } from "next/server";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function getRecordString(value: unknown, key: string): string | undefined {
  if (!isJsonRecord(value)) return undefined;
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
}

export function jsonNoStore<T>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...NO_STORE_HEADERS,
      ...(init?.headers ?? {}),
    },
  });
}

export function safeErrorMessage(error: unknown, fallback = "Unexpected error"): string {
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : getRecordString(error, "message") ?? fallback;

  return raw
    .replace(/(Bearer\s+)[\w.-]+/gi, "$1[REDACTED]")
    .replace(/(api[-_ ]?key\s*[:=]\s*)\w+/gi, "$1[REDACTED]")
    .replace(/https?:\/\/[^\s)]+/gi, "[redacted-url]");
}

export function mapErrorStatus(message: string, fallback = 500): number {
  if (/validation|required|invalid|must be/i.test(message)) return 400;
  if (/missing openai|missing .*_id/i.test(message)) return 500;
  if (/429|rate limit/i.test(message)) return 429;
  if (/aborterror|aborted|timeout|timed out|etimedout/i.test(message)) return 504;
  return fallback;
}

export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export function isRetryableStatus(status: number) {
  return status === 429 || (status >= 500 && status <= 599);
}
