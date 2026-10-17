import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DRIVER_OP_SAMPLE_ENV,
  driverOperationSampleRate,
  shouldLogDriverOperation,
} from "./_shared";

describe("driver operation log sampling", () => {
  it("samples only the location module by default", () => {
    assert.equal(driverOperationSampleRate("location", undefined), 5);
    assert.equal(driverOperationSampleRate("duty", undefined), 1);
    assert.equal(driverOperationSampleRate("delivery", undefined), 1);
    assert.equal(driverOperationSampleRate("esign", undefined), 1);
    assert.equal(DRIVER_OP_SAMPLE_ENV, "DRIVER_OP_LOG_SAMPLE");
  });

  it("turns sampling off with `off` so an incident can keep every row", () => {
    assert.equal(driverOperationSampleRate("location", "off"), 1);
    assert.equal(driverOperationSampleRate("location", "0"), 1);
  });

  it("lets the env override add and replace modules", () => {
    assert.equal(driverOperationSampleRate("duty", "duty=10"), 10);
    assert.equal(driverOperationSampleRate("location", "location=1"), 1);
    assert.equal(driverOperationSampleRate("duty", "location=2, duty=3"), 3);
    // A malformed entry is ignored rather than sampling everything away.
    assert.equal(driverOperationSampleRate("duty", "duty=nope"), 1);
    assert.equal(driverOperationSampleRate("duty", "duty=0"), 1);
    assert.equal(driverOperationSampleRate("location", "=5"), 5);
  });

  it("keeps every row for a module with no sample rate", () => {
    assert.equal(shouldLogDriverOperation("duty", () => 0.999, undefined), true);
  });

  it("keeps roughly one in N rows for a sampled module", () => {
    assert.equal(shouldLogDriverOperation("location", () => 0.1, undefined), true);
    assert.equal(shouldLogDriverOperation("location", () => 0.99, undefined), false);
  });
});
