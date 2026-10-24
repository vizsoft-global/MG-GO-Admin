import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_UNPROVEN,
  SessionUnprovenError,
  isSessionUnprovenError,
} from "./session-unproven";

test("isSessionUnprovenError matches the layout throw and the legacy string", () => {
  assert.equal(isSessionUnprovenError(new SessionUnprovenError()), true);
  assert.equal(isSessionUnprovenError(new Error(SESSION_UNPROVEN)), true);
  assert.equal(isSessionUnprovenError(new Error("auth_backend_unavailable")), true);
  assert.equal(isSessionUnprovenError(new Error("Unauthenticated")), false);
  assert.equal(isSessionUnprovenError(new Error("The server timed out")), true);
  assert.equal(isSessionUnprovenError({ name: "AbortError", message: "Aborted" }), true);
  assert.equal(isSessionUnprovenError({ name: "TimeoutError", message: "" }), true);
  assert.equal(isSessionUnprovenError(null), false);
});
