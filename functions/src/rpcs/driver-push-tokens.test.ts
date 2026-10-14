import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildTransactionalFcmData,
  inboxOpenFields,
  isDeadFcmCode,
  isInboxUnread,
  isInboxVisible,
  normalizePushPlatform,
  pickLatestActivePushToken,
  pushTokenDocId,
} from "./driver-push-tokens";

describe("pushTokenDocId", () => {
  it("is stable and not the raw token", () => {
    const token = "fcm-token-abcdefghijklmnopqrstuvwxyz";
    const id = pushTokenDocId(token);
    assert.equal(id, pushTokenDocId(token));
    assert.notEqual(id, token);
    assert.equal(id.length, 64);
  });
});

describe("normalizePushPlatform", () => {
  it("accepts ios and android", () => {
    assert.equal(normalizePushPlatform("iOS"), "ios");
    assert.equal(normalizePushPlatform("android"), "android");
    assert.equal(normalizePushPlatform("web"), null);
    assert.equal(normalizePushPlatform(1), null);
  });
});

describe("pickLatestActivePushToken", () => {
  it("keeps the most recently seen active token", () => {
    const picked = pickLatestActivePushToken([
      {
        id: "old",
        driver_id: "d1",
        token: "kw-token",
        last_seen_at: "2026-08-11T03:55:37Z",
        is_active: true,
      },
      {
        id: "new",
        driver_id: "d1",
        token: "prod-token",
        last_seen_at: "2026-08-17T12:04:12Z",
        is_active: true,
      },
      {
        id: "dead",
        driver_id: "d1",
        token: "newer-but-off",
        last_seen_at: "2026-10-01T00:00:00Z",
        is_active: false,
      },
    ]);
    assert.equal(picked?.id, "new");
  });

  it("returns null when no active token exists", () => {
    assert.equal(
      pickLatestActivePushToken([
        {
          id: "off",
          driver_id: "d1",
          token: "x",
          last_seen_at: "2026-10-01T00:00:00Z",
          is_active: false,
        },
      ]),
      null,
    );
  });
});

describe("inboxOpenFields", () => {
  it("stores explicit nulls so the rider list query can see the row", () => {
    const fields = inboxOpenFields();
    assert.equal(fields.dismissed_at, null);
    assert.equal(fields.opened_at, null);
    assert.equal(isInboxVisible({}), true);
    assert.equal(isInboxVisible({ dismissed_at: null }), true);
    assert.equal(isInboxVisible({ dismissed_at: "2026-10-14T00:00:00Z" }), false);
    assert.equal(isInboxUnread({}), true);
    assert.equal(isInboxUnread({ dismissed_at: null, opened_at: "2026-10-14T00:00:00Z" }), false);
  });
});

describe("isDeadFcmCode", () => {
  it("deactivates permanent token failures only", () => {
    assert.equal(isDeadFcmCode("messaging/registration-token-not-registered"), true);
    assert.equal(isDeadFcmCode("messaging/sender-id-mismatch"), true);
    assert.equal(isDeadFcmCode("messaging/unavailable"), false);
    assert.equal(isDeadFcmCode("unknown"), false);
  });
});

describe("buildTransactionalFcmData", () => {
  it("carries campaign_id and dispatch_item_id as strings", () => {
    const data = buildTransactionalFcmData({
      driverId: "d1",
      title: "Visit note",
      body: "Bring civil ID",
      campaignId: "c1",
      dispatchItemId: "i1",
      category: "operations",
      priority: "high",
      deepLink: "musallam:///profile/support/visits",
      actionParams: { record_type: "visit", record_id: "b1" },
    });
    assert.equal(data.campaign_id, "c1");
    assert.equal(data.dispatch_item_id, "i1");
    assert.equal(data.action_type, "open_record");
    assert.equal(data.deep_link, "musallam:///profile/support/visits");
    assert.equal(JSON.parse(data.action_params).record_type, "visit");
  });
});
