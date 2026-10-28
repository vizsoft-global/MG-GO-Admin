import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reportedInstallBuild } from "./driver-devices";

describe("reportedInstallBuild", () => {
  it("prints the build the phone reported after login", () => {
    assert.deepEqual(
      reportedInstallBuild({
        sessionCode: 115,
        sessionName: "1.1.25",
        driverCode: 118,
        driverName: "1.1.26",
      }),
      { code: 118, name: "1.1.26" },
    );
  });

  it("keeps a newer session when the driver row is older", () => {
    assert.deepEqual(
      reportedInstallBuild({
        sessionCode: 115,
        sessionName: "1.1.25",
        driverCode: 110,
        driverName: "1.1.25",
      }),
      { code: 115, name: "1.1.25" },
    );
  });

  it("uses the driver row when the session has no build", () => {
    assert.deepEqual(
      reportedInstallBuild({
        sessionCode: null,
        sessionName: null,
        driverCode: 116,
        driverName: "1.1.25",
      }),
      { code: 116, name: "1.1.25" },
    );
  });
});
