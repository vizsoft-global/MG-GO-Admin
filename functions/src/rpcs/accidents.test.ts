import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ACCIDENT_ATTACHMENT_FOLDER,
  ACCIDENT_REFERENCE_COUNTER,
  MAX_ACCIDENT_ATTACHMENTS,
  RIDER_REPORT_CASE_STATUS,
  RIDER_REPORT_VEHICLE_CASE_STATUS,
  accidentAttachmentKeyValid,
  formatAccidentReference,
  validateAccidentReport,
  type AccidentReportInput,
} from "./accidents";

const UID = "9JfM0181bxQBjaZRuBhL58Tb4Gy1";
const NOW = new Date("2026-11-02T10:00:00.000Z");

function input(overrides: Partial<AccidentReportInput> = {}): AccidentReportInput {
  return {
    occurredAt: "2026-11-01T18:30:00.000Z",
    locationText: "Ring Road",
    locationLat: 29.3,
    locationLng: 47.9,
    otherPartyName: "Ahmed",
    otherPartyPlate: "12345",
    otherPartyPhone: "+965 9000 1234",
    description: "rear bumper",
    attachmentKeys: [`drivers/${UID}/${ACCIDENT_ATTACHMENT_FOLDER}/2026-11-02/a.jpg`],
    ...overrides,
  };
}

describe("rider accident report rules", () => {
  it("formats the same ACC-#### reference the admin writes", () => {
    assert.equal(formatAccidentReference(1), "ACC-0001");
    assert.equal(formatAccidentReference(1234), "ACC-1234");
    assert.equal(formatAccidentReference(0), "");
    assert.equal(ACCIDENT_REFERENCE_COUNTER, "accident_reference_seq");
  });

  it("binds an attachment key to the calling rider", () => {
    assert.equal(
      accidentAttachmentKeyValid(UID, `drivers/${UID}/${ACCIDENT_ATTACHMENT_FOLDER}/2026-11-02/a.jpg`),
      true,
    );
    assert.equal(
      accidentAttachmentKeyValid(UID, `drivers/other/${ACCIDENT_ATTACHMENT_FOLDER}/2026-11-02/a.jpg`),
      false,
    );
    assert.equal(accidentAttachmentKeyValid(UID, `vehicles/v1/accidents/a.jpg`), false);
    assert.equal(
      accidentAttachmentKeyValid(UID, `drivers/${UID}/${ACCIDENT_ATTACHMENT_FOLDER}/../../a.jpg`),
      false,
    );
    assert.equal(accidentAttachmentKeyValid("", "drivers/x/a.jpg"), false);
  });

  it("refuses a future date", () => {
    const result = validateAccidentReport(input({ occurredAt: "2026-12-01T09:00:00.000Z" }), NOW);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "future_date");
  });

  it("accepts a thirty-day-old accident — the seven-day window is gone", () => {
    const thirtyDays = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
    const result = validateAccidentReport(
      input({ occurredAt: thirtyDays.toISOString() }),
      NOW,
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.occurredAt.getTime(), thirtyDays.getTime());
  });

  it("has no lower bound at all", () => {
    const result = validateAccidentReport(input({ occurredAt: "2019-03-04T08:00:00.000Z" }), NOW);
    assert.equal(result.ok, true);
  });

  it("requires a location, valid coordinates and at least one file", () => {
    const noLocation = validateAccidentReport(input({ locationText: "   " }), NOW);
    const badCoords = validateAccidentReport(input({ locationLat: 300 }), NOW);
    const noFiles = validateAccidentReport(input({ attachmentKeys: [] }), NOW);
    const tooMany = validateAccidentReport(
      input({ attachmentKeys: Array.from({ length: MAX_ACCIDENT_ATTACHMENTS + 1 }, (_, i) => `k${i}`) }),
      NOW,
    );
    assert.equal(noLocation.ok, false);
    assert.equal(badCoords.ok, false);
    assert.equal(noFiles.ok, false);
    assert.equal(tooMany.ok, false);
    if (!noLocation.ok) assert.equal(noLocation.error, "location_required");
    if (!badCoords.ok) assert.equal(badCoords.error, "invalid_location");
    if (!noFiles.ok) assert.equal(noFiles.error, "attachment_required");
    if (!tooMany.ok) assert.equal(tooMany.error, "too_many_attachments");
  });

  it("starts a rider report Pending and Case Check", () => {
    // The two constants the callable writes; a rider never closes their own case.
    assert.equal(RIDER_REPORT_CASE_STATUS, "pending");
    assert.equal(RIDER_REPORT_VEHICLE_CASE_STATUS, "case_check");
  });

  it("refuses an unparseable date", () => {
    const result = validateAccidentReport(input({ occurredAt: "not-a-date" }), NOW);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "invalid_date");
  });
});
