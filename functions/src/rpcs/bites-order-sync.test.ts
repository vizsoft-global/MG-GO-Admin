import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { BITES_DELIVERY_FIELDS, BITES_ORDER_FIELDS } from "../core/bites";
import {
  bitesMilestoneData,
  bitesOrderIdCandidates,
  type BitesMilestone,
} from "./bites-order-sync";

const AT = new Date("2026-10-16T09:30:00.000Z");

describe("bitesOrderIdCandidates", () => {
  it("tries the digits alone, then the legacy prefixed spelling", () => {
    assert.deepEqual(bitesOrderIdCandidates("1215"), ["1215", "ORDBTS1215"]);
    // A rider who read a legacy docket normalises to the same two candidates.
    assert.deepEqual(bitesOrderIdCandidates("ORDBTS1215"), ["1215", "ORDBTS1215"]);
    assert.deepEqual(bitesOrderIdCandidates("ordbts1215"), ["1215", "ORDBTS1215"]);
  });

  it("strips the hash the customer app prints and drops empties", () => {
    assert.deepEqual(bitesOrderIdCandidates(" #1215# "), ["1215", "ORDBTS1215"]);
    assert.deepEqual(bitesOrderIdCandidates("   "), []);
    assert.deepEqual(bitesOrderIdCandidates(null), []);
  });
});

describe("bitesMilestoneData", () => {
  const milestone: BitesMilestone = {
    status: "PICKED",
    timeField: BITES_DELIVERY_FIELDS.pickupTime,
    at: AT,
  };

  it("uses dotted delivery paths so the rest of delivery_info survives", () => {
    const data = bitesMilestoneData(milestone);
    const delivery = BITES_ORDER_FIELDS.deliveryInfo;
    assert.equal(data[`${delivery}.${BITES_DELIVERY_FIELDS.status}`], "PICKED");
    assert.equal(
      data[`${delivery}.${BITES_DELIVERY_FIELDS.pickupTime}`] instanceof Timestamp,
      true,
    );
    // A plain `delivery_info` object here would wipe created_at and the address.
    assert.equal(delivery in data, false);
  });

  it("keeps the top-level status in step with the delivery status", () => {
    const data = bitesMilestoneData(milestone);
    assert.equal(data[BITES_ORDER_FIELDS.status], "PICKED");
    assert.equal(data[BITES_ORDER_FIELDS.updatedAt] instanceof Timestamp, true);
  });

  it("omits partner fields it was not given, and blanks for none", () => {
    const noPartner = bitesMilestoneData(milestone);
    assert.equal(
      `${BITES_ORDER_FIELDS.deliveryInfo}.${BITES_DELIVERY_FIELDS.partnerName}` in noPartner,
      false,
    );

    const withPartner = bitesMilestoneData({
      ...milestone,
      partner: { uid: "d1", name: "Ali", phone: "96550000000" },
    });
    const delivery = BITES_ORDER_FIELDS.deliveryInfo;
    assert.equal(withPartner[`${delivery}.${BITES_DELIVERY_FIELDS.partnerUid}`], "d1");
    assert.equal(withPartner[`${delivery}.${BITES_DELIVERY_FIELDS.partnerName}`], "Ali");
    assert.equal(withPartner[`${delivery}.${BITES_DELIVERY_FIELDS.partnerPhone}`], "96550000000");
  });
});
