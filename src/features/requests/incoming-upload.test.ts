import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { incomingUploadReady, incomingUploadStartsRoute } from "./incoming-upload";

describe("incoming upload", () => {
  it("refuses a missing rider, subject or attachment", () => {
    assert.equal(incomingUploadReady({ driverId: "", subject: "Letter", fileCount: 1 }), false);
    assert.equal(incomingUploadReady({ driverId: "d", subject: "  ", fileCount: 1 }), false);
    assert.equal(incomingUploadReady({ driverId: "d", subject: "Letter", fileCount: 0 }), false);
    assert.equal(incomingUploadReady({ driverId: "d", subject: "Letter", fileCount: 1 }), true);
  });

  it("starts the approval route only when the toggle is on", () => {
    assert.equal(incomingUploadStartsRoute(true), true);
    assert.equal(incomingUploadStartsRoute(false), false);
  });
});
