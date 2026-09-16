import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getAudienceStepBlockReason,
  isAudienceStepValid,
  type AudienceStepInput,
} from "./notification-validation";

const GROUPS = [
  { id: "empty-a", member_count: 0 },
  { id: "empty-b", member_count: 0 },
  { id: "busy", member_count: 4 },
];

function audience(overrides: Partial<AudienceStepInput> = {}): AudienceStepInput {
  return {
    targetMode: "group",
    zoneIds: [],
    partnerIds: [],
    groupIds: [],
    driverIds: [],
    statuses: [],
    importSpec: null,
    audienceCount: null,
    groups: GROUPS,
    ...overrides,
  };
}

describe("isAudienceStepValid group mode", () => {
  it("rejects no selected groups", () => {
    assert.equal(isAudienceStepValid(audience()), false);
  });

  it("rejects selected groups that are not in the catalog", () => {
    assert.equal(
      isAudienceStepValid(audience({ groupIds: ["missing"] })),
      false,
    );
  });

  it("rejects only empty groups when member_count sums to 0", () => {
    assert.equal(
      isAudienceStepValid(audience({ groupIds: ["empty-a", "empty-b"] })),
      false,
    );
  });

  it("rejects empty groups after an estimate of 0", () => {
    assert.equal(
      isAudienceStepValid(
        audience({ groupIds: ["empty-a"], audienceCount: 0 }),
      ),
      false,
    );
  });

  it("accepts empty groups when estimate finds recipients", () => {
    assert.equal(
      isAudienceStepValid(
        audience({ groupIds: ["empty-a"], audienceCount: 2 }),
      ),
      true,
    );
  });

  it("accepts a group with members before estimate", () => {
    assert.equal(isAudienceStepValid(audience({ groupIds: ["busy"] })), true);
  });

  it("accepts a mix when at least one selected group has members", () => {
    assert.equal(
      isAudienceStepValid(audience({ groupIds: ["empty-a", "busy"] })),
      true,
    );
  });

  it("rejects a member group after an estimate of 0", () => {
    assert.equal(
      isAudienceStepValid(audience({ groupIds: ["busy"], audienceCount: 0 })),
      false,
    );
  });
});

describe("getAudienceStepBlockReason", () => {
  it("asks to select a target when no group is chosen", () => {
    assert.equal(getAudienceStepBlockReason(audience()), "select_target");
  });

  it("asks to select a target when selected ids are unknown", () => {
    assert.equal(
      getAudienceStepBlockReason(audience({ groupIds: ["missing"] })),
      "select_target",
    );
  });

  it("returns empty_group when only empty groups are selected", () => {
    assert.equal(
      getAudienceStepBlockReason(audience({ groupIds: ["empty-a"] })),
      "empty_group",
    );
  });

  it("returns empty_group when estimate is 0", () => {
    assert.equal(
      getAudienceStepBlockReason(
        audience({ groupIds: ["busy"], audienceCount: 0 }),
      ),
      "empty_group",
    );
  });

  it("returns null when group audience is valid", () => {
    assert.equal(
      getAudienceStepBlockReason(audience({ groupIds: ["busy"] })),
      null,
    );
  });

  it("keeps estimate_required for all-drivers with no count", () => {
    assert.equal(
      getAudienceStepBlockReason(audience({ targetMode: "all", groups: [] })),
      "estimate_required",
    );
  });
});
