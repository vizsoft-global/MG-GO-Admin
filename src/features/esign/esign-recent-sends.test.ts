import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeEsignRecentSends } from "./esign-recent-sends";
import type { EsignTrackerBatch } from "./esign-tracker";
import type { EsignBatchRow, EsignListRow } from "./types";

function batch(partial: Partial<EsignBatchRow> & { id: string; created_at: string }): EsignBatchRow {
  return {
    batch_code: partial.batch_code ?? "BAT-1",
    template_id: "t1",
    template_name: "Loan",
    title: partial.title ?? "Loan pack",
    language: "en",
    status: "completed",
    total_count: 2,
    created_count: 2,
    failed_count: 0,
    due_at: null,
    source_filename: partial.source_filename ?? "sheet.xlsx",
    ...partial,
  };
}

function trackerRow(
  id: string,
  created_at: string,
  signed: number,
  total: number,
): EsignTrackerBatch {
  return {
    batch: batch({ id, created_at }),
    progress: {
      total,
      signed,
      declined: 0,
      opened: 0,
      notOpened: total - signed,
      other: 0,
      percent: total ? (signed / total) * 100 : 0,
    },
    stage: signed === total ? "completed" : "in_progress",
  };
}

function single(
  partial: Pick<EsignListRow, "id" | "created_at"> & Partial<EsignListRow>,
): EsignListRow {
  return {
    request_code: "SIG-1",
    title: partial.title ?? "Single loan",
    category_key: "loan",
    category_label: "Loan",
    driver_id: "d1",
    driver_name: "Rider",
    driver_code: "10001",
    status: partial.status ?? "pending",
    due_at: null,
    screenshot_restricted: false,
    sent_at: partial.created_at,
    viewed_at: null,
    declined_at: null,
    signed_at: null,
    signer_display_name: null,
    batch_id: partial.batch_id ?? null,
    recipient_stage: partial.recipient_stage,
    ...partial,
  };
}

describe("mergeEsignRecentSends", () => {
  it("merges batches and singles by created_at and caps at 5", () => {
    const tracker = [
      trackerRow("b1", "2026-10-01T10:00:00.000Z", 1, 2),
      trackerRow("b2", "2026-10-03T10:00:00.000Z", 2, 2),
    ];
    const singles = [
      single({ id: "s1", created_at: "2026-10-04T10:00:00.000Z" }),
      single({ id: "s2", created_at: "2026-10-02T10:00:00.000Z", status: "signed", recipient_stage: "signed" }),
      single({ id: "s3", created_at: "2026-09-01T10:00:00.000Z" }),
      single({ id: "s4", created_at: "2026-09-02T10:00:00.000Z" }),
      single({ id: "s5", created_at: "2026-09-03T10:00:00.000Z" }),
    ];
    const rows = mergeEsignRecentSends(tracker, singles, 5);
    assert.deepEqual(
      rows.map((row) => row.id),
      ["s1", "b2", "s2", "b1", "s5"],
    );
    assert.equal(rows[0]?.kind, "single");
    assert.equal(rows[0]?.href, "/requests/esign/s1");
    assert.equal(rows[1]?.kind, "batch");
    assert.equal(rows[1]?.href, "/employeedesk/esign/batches/b2");
    assert.equal(rows[2]?.signed, 1);
    assert.equal(rows[2]?.percent, 100);
  });

  it("drops singles that already belong to a batch", () => {
    const rows = mergeEsignRecentSends(
      [trackerRow("b1", "2026-10-01T10:00:00.000Z", 0, 1)],
      [single({ id: "s1", created_at: "2026-10-05T10:00:00.000Z", batch_id: "b1" })],
    );
    assert.deepEqual(
      rows.map((row) => row.id),
      ["b1"],
    );
  });
});
