import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyAvatarKey,
  classifyLoginVerificationKey,
  forceUpdateFromDriver,
  sanitizeReportDeviceMeta,
} from "./driver-profile";

const DRIVER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("classifyAvatarKey", () => {
  it("accepts the two owned prefixes and a clear", () => {
    assert.equal(classifyAvatarKey(DRIVER_ID, null), "ok");
    assert.equal(
      classifyAvatarKey(DRIVER_ID, `driver-avatars/${DRIVER_ID}/photo.jpg`),
      "ok",
    );
    assert.equal(classifyAvatarKey(DRIVER_ID, `drivers/${DRIVER_ID}/avatar.png`), "ok");
  });

  it("rejects traversal and another rider's prefix", () => {
    assert.equal(
      classifyAvatarKey(DRIVER_ID, `driver-avatars/${DRIVER_ID}/../x.jpg`),
      "path_traversal",
    );
    assert.equal(
      classifyAvatarKey(DRIVER_ID, "drivers/other/avatar.png"),
      "outside_own_prefix",
    );
    assert.equal(
      classifyAvatarKey(DRIVER_ID, `drivers/${DRIVER_ID}/driver_selfie.jpg`),
      "outside_own_prefix",
    );
  });
});

describe("sanitizeReportDeviceMeta", () => {
  it("keeps the SQL allowlist and drops junk", () => {
    const out = sanitizeReportDeviceMeta({
      model: "Pixel 9",
      manufacturer: "Google",
      supported_abis: ["arm64-v8a", "armeabi-v7a", 1, ""],
      app_version_code: 90,
      battery_pct: 81,
      battery_temp_c: 31.26,
      battery_health: "GOOD",
      charging_state: "charging",
      is_physical_device: true,
      secret: "nope",
      os_version: "unknown",
      locale: null,
      ram_total_mb: 8.5,
    });
    assert.deepEqual(out, {
      model: "Pixel 9",
      manufacturer: "Google",
      supported_abis: ["arm64-v8a", "armeabi-v7a"],
      app_version_code: 90,
      battery_pct: 81,
      battery_temp_c: 31.3,
      battery_health: "good",
      charging_state: "charging",
      is_physical_device: true,
    });
  });

  it("returns empty for non-objects", () => {
    assert.deepEqual(sanitizeReportDeviceMeta(null), {});
    assert.deepEqual(sanitizeReportDeviceMeta([]), {});
  });
});

describe("classifyLoginVerificationKey", () => {
  it("requires the rider-owned login_verification prefix", () => {
    assert.equal(classifyLoginVerificationKey(DRIVER_ID, null), "object_key_required");
    assert.equal(classifyLoginVerificationKey(DRIVER_ID, ""), "object_key_required");
    assert.equal(
      classifyLoginVerificationKey(
        DRIVER_ID,
        `drivers/${DRIVER_ID}/login_verification/2026-10-09/x.jpg`,
      ),
      "ok",
    );
    assert.equal(
      classifyLoginVerificationKey(DRIVER_ID, `drivers/${DRIVER_ID}/avatar.png`),
      "invalid_object_key",
    );
    assert.equal(
      classifyLoginVerificationKey(
        DRIVER_ID,
        `drivers/${DRIVER_ID}/login_verification/../x.jpg`,
      ),
      "invalid_object_key",
    );
  });
});

describe("forceUpdateFromDriver", () => {
  it("clears once the reported build meets the floor", () => {
    const driver = { force_app_update_at: "2026-10-01T00:00:00Z", force_app_update_min_code: 90 };
    assert.deepEqual(forceUpdateFromDriver(driver, 90, "update"), {
      clear: true,
      payload: null,
    });
    assert.deepEqual(forceUpdateFromDriver(driver, 89, "update"), {
      clear: false,
      payload: { min_version_code: 90, message: "update" },
    });
    assert.deepEqual(forceUpdateFromDriver({}, 99, "update"), {
      clear: false,
      payload: null,
    });
  });
});
