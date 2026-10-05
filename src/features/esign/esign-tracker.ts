import {
  esignBatchProgress,
  esignBatchStage,
  esignRecipientStage,
  remindCooldownHoursLeft,
  type EsignBatchProgress,
  type EsignBatchStage,
  type EsignRecipientStage,
} from "./esign-recipient-stage";
import type { EsignBatchRow, EsignListRow } from "./types";

/**
 * The read model behind `Sent for signature` — the tracker list and the batch
 * detail page.
 *
 * `esign-recipient-stage.ts` already answers the per-row questions ("what stage
 * is this rider at", "what stage is this batch at"). This module is the layer
 * above it: it rolls a batch's recipients up into the numbers the three screens
 * actually print — the four KPI tiles, the tab counts on both the batch list and
 * inside a batch, and the reminder button's eligibility.
 *
 * It exists as a pure module rather than as expressions inside the two shells
 * for the reason the reference makes obvious: the *same* numbers appear in four
 * places on one screen (KPI tile, tab label, progress cell, filter) and the one
 * thing that must never happen is two of them disagreeing. Every one of them
 * reads a value computed here.
 */

/** A batch plus the roll-up of its recipients, which is what every cell draws. */
export type EsignTrackerBatch = {
  batch: EsignBatchRow;
  progress: EsignBatchProgress;
  stage: EsignBatchStage;
};

/** The tracker's tabs are about the *batch*, derived from its recipients. */
export type EsignTrackerTab = "all" | EsignBatchStage;

/** The tabs inside a batch are about one recipient's stage. */
export type EsignRecipientTab = "all" | "signed" | "waiting" | "declined";

export const ESIGN_TRACKER_TABS: EsignTrackerTab[] = [
  "all",
  "in_progress",
  "completed",
  "has_declines",
];

/**
 * `waiting` deliberately covers both "opened, not signed" and "not opened".
 *
 * The reference draws them as separate status chips because the operator's next
 * action differs — remind versus phone — but its *tabs* are `All / Signed /
 * Waiting / Declined`, because both of those riders are still the operator's
 * outstanding work and a batch's "waiting" count has to mean everyone who has
 * not answered. Splitting the tab would make neither number match the progress
 * cell above it.
 */
export const ESIGN_RECIPIENT_TABS: EsignRecipientTab[] = [
  "all",
  "signed",
  "waiting",
  "declined",
];

/** The KPI window the reference names: `Batches sent (30d)`. */
export const ESIGN_TRACKER_KPI_WINDOW_DAYS = 30;

/** `EsignRecipientStage` → the tab it belongs to; `expired`/`cancelled` only in All. */
export function recipientTab(stage: EsignRecipientStage): EsignRecipientTab {
  if (stage === "signed") return "signed";
  if (stage === "declined") return "declined";
  if (stage === "opened" || stage === "not_opened") return "waiting";
  return "all";
}

/** i18n leaf under `…tracker.recipientStatus` for a stage. */
export function recipientStatusKey(
  stage: EsignRecipientStage,
): "signed" | "opened" | "notOpened" | "declined" | "expired" | "cancelled" {
  if (stage === "signed") return "signed";
  if (stage === "opened") return "opened";
  if (stage === "declined") return "declined";
  if (stage === "expired") return "expired";
  if (stage === "cancelled") return "cancelled";
  return "notOpened";
}

/** i18n leaf under `…tracker.batchStatus` for a derived batch stage. */
export function batchStageKey(
  stage: EsignBatchStage,
): "waiting" | "inProgress" | "completed" | "hasDeclines" {
  if (stage === "completed") return "completed";
  if (stage === "has_declines") return "hasDeclines";
  if (stage === "in_progress") return "inProgress";
  return "waiting";
}

/**
 * Fold recipients onto their batches.
 *
 * Recipients whose `batch_id` matches no listed batch are dropped rather than
 * silently attached to batch `undefined`: a request sent one-at-a-time from a
 * template has no batch, and counting it toward a batch's progress would make
 * that batch's `18/24` disagree with the rows underneath it.
 */
export function buildEsignTracker(
  batches: EsignBatchRow[],
  recipients: { batch_id: string | null; status: string; viewed_at: string | null }[],
): EsignTrackerBatch[] {
  const byBatch = new Map<string, { status: string; viewed_at: string | null }[]>();
  for (const row of recipients) {
    if (!row.batch_id) continue;
    const list = byBatch.get(row.batch_id);
    if (list) list.push(row);
    else byBatch.set(row.batch_id, [row]);
  }
  return batches.map((batch) => {
    const rows = byBatch.get(batch.id) ?? [];
    const progress = esignBatchProgress(rows);
    return { batch, progress, stage: esignBatchStage(progress) };
  });
}

export type EsignTrackerKpis = {
  /** Batches whose `created_at` is inside the window. */
  batchesSent30d: number;
  /** Recipients who still have to act — opened or not. */
  waiting: number;
  fullySigned: number;
  declined: number;
};

/**
 * The four tiles, from the same roll-up the table and tabs read.
 *
 * `batchesSent30d` is the only figure that looks at `created_at`; the other
 * three are totals across every batch in hand. That asymmetry is the
 * reference's, and it is worth keeping: "how much did we send" is a window
 * question, while "how many people are still holding a document" is not — a
 * rider who has not signed a June batch is still outstanding today.
 */
export function trackerKpis(
  rows: EsignTrackerBatch[],
  nowMs: number,
): EsignTrackerKpis {
  const cutoff = nowMs - ESIGN_TRACKER_KPI_WINDOW_DAYS * 24 * 3_600_000;
  let batchesSent30d = 0;
  let waiting = 0;
  let fullySigned = 0;
  let declined = 0;
  for (const row of rows) {
    const createdAt = Date.parse(row.batch.created_at);
    if (!Number.isNaN(createdAt) && createdAt >= cutoff) batchesSent30d += 1;
    waiting += row.progress.opened + row.progress.notOpened;
    fullySigned += row.progress.signed;
    declined += row.progress.declined;
  }
  return { batchesSent30d, waiting, fullySigned, declined };
}

/** Tab labels carry a count, so the tabs and the table cannot disagree. */
export function trackerTabCounts(
  rows: EsignTrackerBatch[],
): Record<EsignTrackerTab, number> {
  const counts: Record<EsignTrackerTab, number> = {
    all: rows.length,
    waiting: 0,
    in_progress: 0,
    completed: 0,
    has_declines: 0,
  };
  for (const row of rows) counts[row.stage] += 1;
  return counts;
}

export function filterTrackerBatches(
  rows: EsignTrackerBatch[],
  tab: EsignTrackerTab,
): EsignTrackerBatch[] {
  if (tab === "all") return rows;
  return rows.filter((row) => row.stage === tab);
}

export function recipientTabCounts(
  rows: { status: string; viewed_at: string | null; stage?: EsignRecipientStage }[],
): Record<EsignRecipientTab, number> {
  const counts: Record<EsignRecipientTab, number> = {
    all: rows.length,
    signed: 0,
    waiting: 0,
    declined: 0,
  };
  for (const row of rows) {
    // `recipientTab` returns the catch-all tab for `expired` / `cancelled`, and
    // `all` is already the row total — incrementing it here would double-count
    // every one of those rows.
    const tab = recipientTab(row.stage ?? esignRecipientStage(row));
    if (tab !== "all") counts[tab] += 1;
  }
  return counts;
}

export function filterRecipients(
  rows: EsignListRow[],
  tab: EsignRecipientTab,
): EsignListRow[] {
  if (tab === "all") return rows;
  return rows.filter((row) => recipientTab(esignRecipientStage(row)) === tab);
}

/** Why a reminder button is off, so the tooltip can say which of the two it is. */
export type EsignRemindEligibility = {
  allowed: boolean;
  hoursLeft: number;
  blockedBy: "stage" | "cooldown" | null;
};

/**
 * Whether a recipient may be reminded right now.
 *
 * Mirrors the server: `admin_remind_esign_requests` skips anything that is not
 * `pending` / `in_progress`, and the 24h ledger window is enforced here so the
 * button is disabled rather than offered and then counted as a no-op. Both
 * refusals are separated in the result because "already signed" and "reminded
 * an hour ago" need different words in the tooltip.
 */
export function remindEligibility(
  row: { status: string; viewed_at: string | null },
  lastRemindedAt: string | null,
  nowMs: number,
): EsignRemindEligibility {
  const stage = esignRecipientStage(row);
  if (stage !== "opened" && stage !== "not_opened") {
    return { allowed: false, hoursLeft: 0, blockedBy: "stage" };
  }
  const hoursLeft = remindCooldownHoursLeft(lastRemindedAt, nowMs);
  if (hoursLeft > 0) return { allowed: false, hoursLeft, blockedBy: "cooldown" };
  return { allowed: true, hoursLeft: 0, blockedBy: null };
}

/** The recipients a bulk `Remind` would actually reach. */
export function remindableIds(
  rows: {
    id: string;
    status: string;
    viewed_at: string | null;
    last_reminded_at?: string | null;
  }[],
  nowMs: number,
): string[] {
  return rows
    .filter((row) => remindEligibility(row, row.last_reminded_at ?? null, nowMs).allowed)
    .map((row) => row.id);
}

/**
 * Senders and templates present in the list, for the two filter dropdowns.
 *
 * Read off the rows rather than queried, so a filter can never offer a value
 * that returns nothing — the operator's most common way to conclude a screen is
 * broken.
 */
export function trackerFilterOptions(rows: EsignTrackerBatch[]): {
  templates: { value: string; label: string }[];
  senders: { value: string; label: string }[];
} {  const templates = new Map<string, string>();
  for (const row of rows) {
    const id = row.batch.template_id;
    if (!id) continue;
    if (!templates.has(id)) {
      templates.set(id, row.batch.template_name?.trim() || row.batch.title);
    }
  }
  return {
    templates: [...templates].map(([value, label]) => ({ value, label })),
    // `esign_batches` records no sender column yet, so the list is honestly
    // empty rather than offering a filter that cannot narrow anything. The
    // dropdown hides itself when this is empty.
    senders: [],
  };
}

const TRACKER_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * A sent date on the Kuwait calendar day, in one fixed shape.
 *
 * Formatted from parts rather than with a locale-formatted string, and in one
 * shape for both locales, deliberately: `Intl` with `ar` emits Arabic-Indic
 * numerals and an Arabic month name, which is right for a printed document and
 * wrong for a sortable column — and the two locales would then order their own
 * dates differently. Reading the day in Kuwait matters for the same reason
 * everywhere else in this panel does: a batch sent at 01:00 local is today's,
 * not yesterday's.
 */
export function formatEsignTrackerDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuwait",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const month = TRACKER_MONTHS[Number(get("month")) - 1] ?? "Jan";
  const day = get("day").replace(/^0/, "");
  return `${day} ${month} ${get("year")}`;
}
