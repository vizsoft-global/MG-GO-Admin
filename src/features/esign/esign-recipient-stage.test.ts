import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ESIGN_REMIND_COOLDOWN_HOURS,
  esignBatchProgress,
  esignBatchStage,
  esignRecipientStage,
  isEsignRemindable,
  remindCooldownHoursLeft,
} from "./esign-recipient-stage";

describe("esignRecipientStage", () => {
  it("separates opened-and-not-signed from not-opened on viewed_at", () => {
    assert.equal(esignRecipientStage({ status: "pending", viewed_at: null }), "not_opened");
    assert.equal(
      esignRecipientStage({ status: "pending", viewed_at: "2026-09-19T10:42:00Z" }),
      "opened",
    );
  });

  it("reads the terminal statuses off status, not off viewed_at", () => {
    // A rider who opened the document and then signed it has a viewed_at, so a
    // viewed_at-first rule would file every signature under "opened".
    const viewed = "2026-09-19T10:42:00Z";
    assert.equal(esignRecipientStage({ status: "signed", viewed_at: viewed }), "signed");
    assert.equal(esignRecipientStage({ status: "signed", viewed_at: null }), "signed");
    assert.equal(esignRecipientStage({ status: "declined", viewed_at: viewed }), "declined");
    assert.equal(esignRecipientStage({ status: "cancelled", viewed_at: null }), "cancelled");
    assert.equal(esignRecipientStage({ status: "expired", viewed_at: null }), "expired");
  });

  it("treats an unknown in-flight status as waiting, never as finished", () => {
    assert.equal(esignRecipientStage({ status: "in_review", viewed_at: null }), "not_opened");
    assert.equal(esignRecipientStage({ status: "", viewed_at: null }), "not_opened");
    assert.equal(esignRecipientStage({ status: "SIGNED", viewed_at: null }), "signed");
  });

  it("only offers a reminder where the server would actually send one", () => {
    assert.equal(isEsignRemindable("not_opened"), true);
    assert.equal(isEsignRemindable("opened"), true);
    for (const stage of ["signed", "declined", "expired", "cancelled"] as const) {
      assert.equal(isEsignRemindable(stage), false, stage);
    }
  });
});

describe("remindCooldownHoursLeft", () => {
  const now = Date.parse("2026-09-20T12:00:00Z");

  it("returns 0 when the recipient has never been reminded", () => {
    assert.equal(remindCooldownHoursLeft(null, now), 0);
    assert.equal(remindCooldownHoursLeft("", now), 0);
  });

  it("counts down the full window from the last reminder", () => {
    const justSent = new Date(now - 60_000).toISOString();
    const left = remindCooldownHoursLeft(justSent, now);
    assert.ok(left > ESIGN_REMIND_COOLDOWN_HOURS - 0.1 && left <= ESIGN_REMIND_COOLDOWN_HOURS);

    const halfWay = new Date(now - 12 * 3_600_000).toISOString();
    assert.equal(Math.round(remindCooldownHoursLeft(halfWay, now)), 12);
  });

  it("stops at 0 once the window has passed and never goes negative", () => {
    const old = new Date(now - 30 * 3_600_000).toISOString();
    assert.equal(remindCooldownHoursLeft(old, now), 0);
    const exactly = new Date(now - ESIGN_REMIND_COOLDOWN_HOURS * 3_600_000).toISOString();
    assert.equal(remindCooldownHoursLeft(exactly, now), 0);
  });

  it("fails open on an unparseable timestamp", () => {
    // Failing closed would lock a recipient out of reminders for a reason the
    // operator cannot see; the server still enforces the real cooldown.
    assert.equal(remindCooldownHoursLeft("not a date", now), 0);
  });
});

describe("esignBatchProgress", () => {
  it("counts each recipient once and rounds the percentage", () => {
    const rows = [
      { status: "signed", viewed_at: "2026-09-19T10:00:00Z" },
      { status: "signed", viewed_at: null },
      { status: "pending", viewed_at: "2026-09-19T10:00:00Z" },
      { status: "pending", viewed_at: null },
      { status: "pending", viewed_at: null },
      { status: "declined", viewed_at: "2026-09-19T10:00:00Z" },
      { status: "expired", viewed_at: null },
    ];
    const progress = esignBatchProgress(rows);
    assert.equal(progress.total, 7);
    assert.equal(progress.signed, 2);
    assert.equal(progress.opened, 1);
    assert.equal(progress.notOpened, 2);
    assert.equal(progress.declined, 1);
    assert.equal(progress.other, 1);
    // 2/7 = 28.57 -> 29, and the five non-signed rows are not rounded away.
    assert.equal(progress.percent, 29);
    assert.equal(
      progress.signed + progress.opened + progress.notOpened + progress.declined + progress.other,
      progress.total,
    );
  });

  it("reports 0% for a batch with no recipients rather than NaN", () => {
    const progress = esignBatchProgress([]);
    assert.equal(progress.total, 0);
    assert.equal(progress.percent, 0);
    assert.equal(esignBatchStage(progress), "waiting");
  });
});

describe("esignBatchStage", () => {
  it("lets a decline outrank completion", () => {
    // 2 of 3 signed with one refusal: the batch is not "completed", because the
    // refusal is the row the operator has to act on.
    const progress = esignBatchProgress([
      { status: "signed", viewed_at: null },
      { status: "signed", viewed_at: null },
      { status: "declined", viewed_at: null },
    ]);
    assert.equal(esignBatchStage(progress), "has_declines");
  });

  it("is completed only when every recipient signed", () => {
    assert.equal(
      esignBatchStage(
        esignBatchProgress([
          { status: "signed", viewed_at: null },
          { status: "signed", viewed_at: null },
        ]),
      ),
      "completed",
    );
    assert.equal(
      esignBatchStage(
        esignBatchProgress([
          { status: "signed", viewed_at: null },
          { status: "pending", viewed_at: "2026-09-19T10:00:00Z" },
        ]),
      ),
      "in_progress",
    );
  });

  it("is waiting until at least one signature arrives", () => {
    const progress = esignBatchProgress([
      { status: "pending", viewed_at: "2026-09-19T10:00:00Z" },
      { status: "pending", viewed_at: null },
      { status: "expired", viewed_at: null },
    ]);
    assert.equal(esignBatchStage(progress), "waiting");
  });

  it("takes a pre-derived stage over re-reading a raw status", () => {
    // The batch detail derives the stage once from the `esign_requests` embed it
    // also draws, expiry applied. Re-deriving it here from the raw status would
    // let the progress bar describe a different state than the stage column
    // beside it on the same screen.
    const progress = esignBatchProgress([
      { status: "pending", viewed_at: null, stage: "signed" },
      { status: "pending", viewed_at: null, stage: "not_opened" },
    ]);
    assert.equal(progress.signed, 1);
    assert.equal(progress.notOpened, 1);
    assert.equal(progress.percent, 50);
  });

  it("keeps undelivered rows in the denominator", () => {
    // 1 of 4 signed, where two of the four rows never produced a document. The
    // honest reading is "1 of 4", not a denominator that quietly shrinks to the
    // recipients that happened to work.
    const progress = esignBatchProgress([{ status: "signed", viewed_at: null }], 4);
    assert.equal(progress.total, 4);
    assert.equal(progress.percent, 25);
  });
});
