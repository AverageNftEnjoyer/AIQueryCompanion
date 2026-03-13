import assert from "node:assert/strict";
import test from "node:test";
import { isRetryableStatus, mapErrorStatus, safeErrorMessage } from "../lib/server/http";

test("safeErrorMessage redacts bearer tokens, api keys, and URLs", () => {
  const raw = "Bearer secret-token api_key=12345 https://example.com/path";
  const sanitized = safeErrorMessage(new Error(raw));

  assert.equal(sanitized.includes("secret-token"), false);
  assert.equal(sanitized.includes("12345"), false);
  assert.equal(sanitized.includes("example.com"), false);
  assert.match(sanitized, /Bearer \[REDACTED]/);
  assert.match(sanitized, /api_key=\[REDACTED]/i);
});

test("mapErrorStatus maps timeout and validation failures consistently", () => {
  assert.equal(mapErrorStatus("timeout while calling upstream", 500), 504);
  assert.equal(mapErrorStatus("newQuery is required", 500), 400);
  assert.equal(mapErrorStatus("rate limit 429", 500), 429);
  assert.equal(mapErrorStatus("unexpected", 500), 500);
});

test("isRetryableStatus matches 429 and 5xx only", () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(404), false);
});
