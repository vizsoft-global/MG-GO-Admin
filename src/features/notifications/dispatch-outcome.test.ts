import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isHardPushFailure,
  isPushSkippedNoToken,
  resolveCampaignDisplayStatus,
  summarizeDispatchOutcomes,
} from "./dispatch-outcome";

describe("dispatch-outcome", () => {
  it("treats no_token as push skip, not hard failure", () => {
    const item = { status: "opened", error_code: "no_token" };
    assert.equal(isPushSkippedNoToken(item), true);
    assert.equal(isHardPushFailure(item), false);
  });

  it("marks all-no-token failed campaigns as sent for display", () => {
    const items = [
      { status: "opened", error_code: "no_token" },
      { status: "skipped", error_code: "no_token" },
    ];
    assert.equal(resolveCampaignDisplayStatus("failed", items), "sent");
    assert.equal(summarizeDispatchOutcomes(items).allPushSkipped, true);
  });

  it("keeps hard FCM failures as failed", () => {
    const items = [{ status: "failed", error_code: "messaging/internal-error" }];
    assert.equal(resolveCampaignDisplayStatus("failed", items), "failed");
    assert.equal(isHardPushFailure(items[0]!), true);
  });
});
