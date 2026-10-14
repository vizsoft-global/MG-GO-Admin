import { esignRecipientStage } from "./esign-recipient-stage";
import type { EsignTrackerBatch } from "./esign-tracker";
import type { EsignListRow } from "./types";

export type EsignRecentSend = {
  kind: "batch" | "single";
  id: string;
  title: string;
  created_at: string;
  signed: number;
  total: number;
  percent: number;
  done: boolean;
  bulk: boolean;
  href: string;
};

const DEFAULT_LIMIT = 5;

/**
 * Unified last-N sends: batches plus one-off requests (`batch_id` null).
 * Does not change `buildEsignTracker`, which stays batch-only.
 */
export function mergeEsignRecentSends(
  tracker: readonly EsignTrackerBatch[],
  singles: readonly EsignListRow[],
  limit = DEFAULT_LIMIT,
): EsignRecentSend[] {
  const batchRows: EsignRecentSend[] = tracker.map((row) => {
    const total = row.progress.total || row.batch.total_count;
    const signed = row.progress.signed;
    const percent = Math.round(row.progress.percent);
    return {
      kind: "batch",
      id: row.batch.id,
      title: row.batch.title || row.batch.template_name || row.batch.batch_code,
      created_at: row.batch.created_at,
      signed,
      total,
      percent,
      done: row.stage === "completed",
      bulk: Boolean(row.batch.source_filename) || total > 1,
      href: `/employeedesk/esign/batches/${row.batch.id}`,
    };
  });

  const singleRows: EsignRecentSend[] = singles
    .filter((row) => !row.batch_id)
    .map((row) => {
      const stage = row.recipient_stage ?? esignRecipientStage(row);
      const signed = stage === "signed" ? 1 : 0;
      return {
        kind: "single",
        id: row.id,
        title: row.title || row.request_code,
        created_at: row.created_at,
        signed,
        total: 1,
        percent: signed * 100,
        done: stage === "signed",
        bulk: false,
        href: `/requests/esign/${row.id}`,
      };
    });

  return [...batchRows, ...singleRows]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || a.id.localeCompare(b.id))
    .slice(0, limit);
}
