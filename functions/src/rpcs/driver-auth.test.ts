import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_UPDATE_MESSAGE,
  FIRST_GATED_VERSION_CODE,
  parseDeviceMeta,
  sanitizeDeviceMetaBlob,
  updateRequiredKind,
} from "./driver-auth";

describe("driver-auth device meta", () => {
  it("keeps the Deno allowlist and drops unknown keys", () => {
    const out = sanitizeDeviceMetaBlob({
      model: "Pixel 9",
      manufacturer: "Google",
      supported_abis: ["arm64-v8a", "armeabi-v7a", 1, ""],
      app_version_code: 90,
      secret: "nope",
      os_version: "unknown",
      locale: null,
    });
    assert.deepEqual(out, {
      model: "Pixel 9",
      manufacturer: "Google",
      supported_abis: ["arm64-v8a", "armeabi-v7a"],
      app_version_code: 90,
    });
  });

  it("parses version fields the same way as the edge function", () => {
    const meta = parseDeviceMeta({
      model: "A",
      manufacturer: "B",
      os_version: "14",
      android_sdk_int: "34",
      app_version_name: "1.1.20",
      app_version_code: "83",
    });
    assert.equal(meta.android_sdk_int, 34);
    assert.equal(meta.app_version_code, 83);
    assert.equal(meta.app_version_name, "1.1.20");
  });
});

describe("driver-auth force-update kind", () => {
  it("uses driver_blocked for pre-gate builds", () => {
    assert.equal(updateRequiredKind(null), "driver_blocked");
    assert.equal(updateRequiredKind(FIRST_GATED_VERSION_CODE - 1), "driver_blocked");
    assert.equal(updateRequiredKind(FIRST_GATED_VERSION_CODE), "update_required");
    assert.equal(updateRequiredKind(200), "update_required");
  });

  it("keeps the bilingual default message", () => {
    assert.match(DEFAULT_UPDATE_MESSAGE, /Google Play/);
    assert.match(DEFAULT_UPDATE_MESSAGE, /يلزم تحديث/);
  });
});
