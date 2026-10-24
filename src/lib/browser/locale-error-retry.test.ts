import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCALE_ERROR_MAX_RETRIES,
  bumpLocaleErrorRetries,
  clearLocaleErrorRetries,
  readLocaleErrorRetries,
} from "./locale-error-retry";

test("locale error retry helpers are safe without sessionStorage", () => {
  assert.equal(typeof sessionStorage, "undefined");
  assert.equal(readLocaleErrorRetries(), 0);
  assert.equal(bumpLocaleErrorRetries(), 1);
  clearLocaleErrorRetries();
  assert.equal(LOCALE_ERROR_MAX_RETRIES, 3);
});
