import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  batchStageKey,
  buildEsignTracker,
  filterRecipients,
  filterTrackerBatches,
  recipientStatusKey,
  recipientTab,
  recipientTabCounts,
  remindEligibility,
  remindableIds,
  trackerFilterOptions,
  trackerKpis,
  trackerTabCounts,
} from "./esign-tracker";
import type { EsignBatchRow, EsignListRow } from "./types";

const NOW = Date.parse("2026-10-05T12:00:00.000Z");

function batch(overrides: Partial<EsignBatchRow> = {}): EsignBatchRow {
  return {
    id: "b1",
    batch_code: "BAT-0318",
    template_id: "t1",
    template_name: "Payslip",
    title: "Payslips - August 2026",
    language: "en",
    status: "completed",
    total_count: 0,
    created_count: 0,
    failed_count: 0,
    due_at: null,
    source_filename: null,
    created_at: "2026-09-18T08:00:00.000Z",
    ...overrides,
  };
}

function recipient(
  batchId: string | null,
  status: string,
  viewedAt: string | null = null,
) {
  return { batch_id: batchId, status, viewed_at: viewedAt };
}

function listRow(overrides: Partial<EsignListRow> = {}): EsignListRow {
  return {
    id: "r1",
    request_code: "SIG-0001",
    title: "Payslip",
    category_key: null,
    category_label: null,
    driver_id: "d1",
    driver_name: "Employee A",
    driver_code: "E-1041",
    status: "pending",
    due_at: null,
    screenshot_restricted: false,
    sent_at: "2026-09-18T08:00:00.000Z",
    viewed_at: null,
    declined_at: null,
    signed_at: null,
    signer_display_name: null,
    created_at: "2026-09-18T08:00:00.000Z",
    ...overrides,
  };
}

describe("buildEsignTracker", () => {
  it("rolls each batch's recipients into progress and a derived stage", () => {
    const rows = buildEsignTracker(
      [batch({ id: "b1" })],
      [
        recipient("b1", "signed"),
        recipient("b1", "signed"),
        recipient("b1", "pending", "2026-09-19T10:00:00.000Z"),
        recipient("b1", "pending"),
      ],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.progress.signed, 2);
    assert.equal(rows[0]!.progress.opened, 1);
    assert.equal(rows[0]!.progress.notOpened, 1);
    assert.equal(rows[0]!.progress.percent, 50);
    assert.equal(rows[0]!.stage, "in_progress");
  });

  it("drops a recipient with no batch rather than attaching it to an unrelated one", () => {
    const rows = buildEsignTracker(
      [batch({ id: "b1" })],
      [recipient("b1", "signed"), recipient(null, "signed")],
    );
    assert.equal(rows[0]!.progress.total, 1);
  });

  it("ignores a recipient whose batch is not in the list", () => {
    const rows = buildEsignTracker([batch({ id: "b1" })], [recipient("b9", "signed")]);
    assert.equal(rows[0]!.progress.total, 0);
    assert.equal(rows[0]!.stage, "waiting");
  });

  it("gives a batch with no recipients 0%, not NaN", () => {
    const rows = buildEsignTracker([batch({ id: "b1" })], []);
    assert.equal(rows[0]!.progress.percent, 0);
  });

  it("lets a decline outrank completion", () => {
    const rows = buildEsignTracker(
      [batch({ id: "b1" })],
      [recipient("b1", "signed"), recipient("b1", "declined")],
    );
    assert.equal(rows[0]!.stage, "has_declines");
  });

  it("is completed only when every recipient signed", () => {
    const rows = buildEsignTracker(
      [batch({ id: "b1" })],
      [recipient("b1", "signed"), recipient("b1", "signed")],
    );
    assert.equal(rows[0]!.stage, "completed");
  });
});

describe("trackerKpis", () => {
  it("counts sent batches in the window but waiting/signed across every batch", () => {
    const rows = buildEsignTracker(
      [
        batch({ id: "b1", created_at: "2026-09-18T08:00:00.000Z" }),
        // Outside the 30d window on purpose: its recipients still count.
        batch({ id: "b2", created_at: "2026-01-18T08:00:00.000Z" }),
      ],
      [
        recipient("b1", "signed"),
        recipient("b1", "pending"),
        recipient("b2", "signed"),
        recipient("b2", "declined"),
      ],
    );
    const kpis = trackerKpis(rows, NOW);
    assert.equal(kpis.batchesSent30d, 1);
    assert.equal(kpis.waiting, 1);
    assert.equal(kpis.fullySigned, 2);
    assert.equal(kpis.declined, 1);
  });

  it("does not count a batch with an unparseable created_at", () => {
    const rows = buildEsignTracker([batch({ created_at: "not-a-date" })], []);
    assert.equal(trackerKpis(rows, NOW).batchesSent30d, 0);
  });
});

describe("tabs", () => {
  const rows = buildEsignTracker(
    [batch({ id: "b1" }), batch({ id: "b2" }), batch({ id: "b3" })],
    [
      recipient("b1", "signed"),
      recipient("b1", "signed"),
      recipient("b2", "signed"),
      recipient("b2", "pending"),
      recipient("b3", "declined"),
    ],
  );

  it("tab counts add up to the list and match the filter", () => {
    const counts = trackerTabCounts(rows);
    assert.deepEqual(counts, {
      all: 3,
      waiting: 0,
      in_progress: 1,
      completed: 1,
      has_declines: 1,
    });
    assert.equal(counts.all, rows.length);
    for (const tab of ["in_progress", "completed", "has_declines"] as const) {
      assert.equal(filterTrackerBatches(rows, tab).length, counts[tab]);
    }
  });

  it("all returns the same set unchanged", () => {
    assert.equal(filterTrackerBatches(rows, "all"), rows);
  });

  it("puts opened and not-opened in the same recipient tab", () => {
    assert.equal(recipientTab("opened"), "waiting");
    assert.equal(recipientTab("not_opened"), "waiting");
  });

  it("keeps expired and cancelled out of every named recipient tab", () => {
    assert.equal(recipientTab("expired"), "all");
    assert.equal(recipientTab("cancelled"), "all");
  });

  it("recipient tab counts exclude terminal-other rows from signed/waiting/declined", () => {
    const counts = recipientTabCounts([
      { status: "signed", viewed_at: null },
      { status: "expired", viewed_at: "2026-09-20T00:00:00.000Z" },
      { status: "pending", viewed_at: null },
    ]);
    assert.deepEqual(counts, { all: 3, signed: 1, waiting: 1, declined: 0 });
  });

  it("filters recipient rows by tab", () => {
    const list = [
      listRow({ id: "a", status: "signed" }),
      listRow({ id: "b", status: "pending", viewed_at: "2026-09-19T10:00:00.000Z" }),
      listRow({ id: "c", status: "pending" }),
      listRow({ id: "d", status: "declined" }),
    ];
    assert.deepEqual(
      filterRecipients(list, "signed").map((r) => r.id),
      ["a"],
    );
    assert.deepEqual(
      filterRecipients(list, "waiting").map((r) => r.id),
      ["b", "c"],
    );
    assert.deepEqual(
      filterRecipients(list, "declined").map((r) => r.id),
      ["d"],
    );
    assert.equal(filterRecipients(list, "all").length, 4);
  });
});

describe("remindEligibility", () => {
  it("allows a rider who has not signed and was never reminded", () => {
    const result = remindEligibility(
      { status: "pending", viewed_at: null },
      null,
      NOW,
    );
    assert.equal(result.allowed, true);
    assert.equal(result.blockedBy, null);
  });

  it("refuses a signed rider by stage, not by cooldown", () => {
    const result = remindEligibility(
      { status: "signed", viewed_at: "2026-09-20T00:00:00.000Z" },
      null,
      NOW,
    );
    assert.equal(result.allowed, false);
    assert.equal(result.blockedBy, "stage");
  });

  it("refuses inside the 24h window and reports the hours left", () => {
    const result = remindEligibility(
      { status: "pending", viewed_at: null },
      "2026-10-05T06:00:00.000Z",
      NOW,
    );
    assert.equal(result.allowed, false);
    assert.equal(result.blockedBy, "cooldown");
    assert.equal(result.hoursLeft, 18);
  });

  it("allows again once the window has passed", () => {
    const result = remindEligibility(
      { status: "pending", viewed_at: null },
      "2026-10-03T12:00:00.000Z",
      NOW,
    );
    assert.equal(result.allowed, true);
  });

  it("treats an unparseable last_reminded_at as never reminded", () => {
    const result = remindEligibility(
      { status: "pending", viewed_at: null },
      "not-a-date",
      NOW,
    );
    assert.equal(result.allowed, true);
  });
});

describe("remindableIds", () => {
  it("returns only the rows a bulk reminder would reach", () => {
    const ids = remindableIds(
      [
        { id: "a", status: "pending", viewed_at: null },
        { id: "b", status: "signed", viewed_at: null },
        {
          id: "c",
          status: "pending",
          viewed_at: null,
          last_reminded_at: "2026-10-05T10:00:00.000Z",
        },
        { id: "d", status: "declined", viewed_at: null },
      ],
      NOW,
    );
    assert.deepEqual(ids, ["a"]);
  });
});

describe("label keys", () => {
  it("names every stage the tracker can draw", () => {
    assert.equal(recipientStatusKey("not_opened"), "notOpened");
    assert.equal(recipientStatusKey("opened"), "opened");
    assert.equal(recipientStatusKey("signed"), "signed");
    assert.equal(recipientStatusKey("declined"), "declined");
    assert.equal(recipientStatusKey("expired"), "expired");
    assert.equal(recipientStatusKey("cancelled"), "cancelled");
  });

  it("names every batch stage, camel-cased for the message catalogue", () => {
    assert.equal(batchStageKey("in_progress"), "inProgress");
    assert.equal(batchStageKey("has_declines"), "hasDeclines");
    assert.equal(batchStageKey("completed"), "completed");
    assert.equal(batchStageKey("waiting"), "waiting");
  });
});

describe("trackerFilterOptions", () => {
  it("lists a template once, whatever its case", () => {
    const options = trackerFilterOptions(
      buildEsignTracker(
        [
          batch({ id: "b1", template_id: "t1" }),
          batch({ id: "b2", template_id: "t1" }),
          batch({ id: "b3", template_id: "t2", template_name: "Loan agreement" }),
        ],
        [],
      ),
    );
    assert.deepEqual(options.templates, [
      { value: "t1", label: "Payslip" },
      { value: "t2", label: "Loan agreement" },
    ]);
  });

  it("falls back to the batch title when the template name is missing", () => {
    const options = trackerFilterOptions(
      buildEsignTracker([batch({ template_id: "t1", template_name: null })], []),
    );
    assert.equal(options.templates[0]!.label, "Payslips - August 2026");
  });

  it("reports no senders, because the schema records none", () => {
    const options = trackerFilterOptions(buildEsignTracker([batch()], []));
    assert.deepEqual(options.senders, []);
  });
});
