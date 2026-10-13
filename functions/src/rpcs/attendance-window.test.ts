import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpsError } from "firebase-functions/v2/https";
import {
  ATTENDANCE_WINDOW_TOO_LARGE_MESSAGE,
  rethrowAttendanceWindow,
} from "./attendance-shared";

describe("rethrowAttendanceWindow", () => {
  it("maps the scan-cap error to failed-precondition with a clear message", () => {
    assert.throws(
      () => rethrowAttendanceWindow(new Error("attendance_window_too_large")),
      (error: unknown) => {
        assert.ok(error instanceof HttpsError);
        assert.equal(error.code, "failed-precondition");
        assert.equal(error.message, ATTENDANCE_WINDOW_TOO_LARGE_MESSAGE);
        assert.match(error.message, /more attendance rows than the list can rank/);
        return true;
      },
    );
  });

  it("leaves other errors untouched", () => {
    const original = new Error("other");
    assert.throws(() => rethrowAttendanceWindow(original), (error: unknown) => error === original);
  });
});
