import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isDriverOwnedAvatarKey,
  pickDriverAvatarKey,
} from "./driver-avatar-key";

const DRIVER_ID = "11111111-1111-1111-1111-111111111111";

describe("pickDriverAvatarKey", () => {
  it("prefers the app avatar_object_key over admin profile/intake URLs", () => {
    assert.equal(
      pickDriverAvatarKey({
        avatarObjectKey: `driver-avatars/${DRIVER_ID}/2026-08-13/new.jpg`,
        profileAvatarUrl: `drivers/${DRIVER_ID}/avatar.jpg`,
        intakeAvatarUrl: "drivers/intakes/aaaa/avatar.jpg",
      }),
      `driver-avatars/${DRIVER_ID}/2026-08-13/new.jpg`,
    );
  });

  it("falls back to profiles.avatar_url then intake", () => {
    assert.equal(
      pickDriverAvatarKey({
        avatarObjectKey: null,
        profileAvatarUrl: `drivers/${DRIVER_ID}/avatar.jpg`,
        intakeAvatarUrl: "drivers/intakes/aaaa/avatar.jpg",
      }),
      `drivers/${DRIVER_ID}/avatar.jpg`,
    );
    assert.equal(
      pickDriverAvatarKey({
        avatarObjectKey: "  ",
        profileAvatarUrl: null,
        intakeAvatarUrl: "drivers/intakes/aaaa/avatar.jpg",
      }),
      "drivers/intakes/aaaa/avatar.jpg",
    );
  });

  it("treats blank strings as missing", () => {
    assert.equal(
      pickDriverAvatarKey({
        avatarObjectKey: "",
        profileAvatarUrl: "  ",
        intakeAvatarUrl: null,
      }),
      null,
    );
  });
});

describe("isDriverOwnedAvatarKey", () => {
  it("accepts app and admin keys for this driver only", () => {
    assert.equal(
      isDriverOwnedAvatarKey(
        DRIVER_ID,
        `driver-avatars/${DRIVER_ID}/2026-08-13/x.jpg`,
      ),
      true,
    );
    assert.equal(
      isDriverOwnedAvatarKey(DRIVER_ID, `drivers/${DRIVER_ID}/avatar.png`),
      true,
    );
    assert.equal(
      isDriverOwnedAvatarKey(
        DRIVER_ID,
        "driver-avatars/22222222-2222-2222-2222-222222222222/x.jpg",
      ),
      false,
    );
    assert.equal(
      isDriverOwnedAvatarKey(DRIVER_ID, `drivers/${DRIVER_ID}/driver_selfie.jpg`),
      false,
    );
  });
});
