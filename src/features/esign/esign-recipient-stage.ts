/**
 * The recipient vocabulary the Sent-for-signature tracker speaks.
 *
 * `esign_requests.status` cannot answer the operator's actual question. The
 * reference draws four states on a recipient row — `Not opened`, `Opened, not
 * signed`, `Declined`, `Signed` — and this schema has three (`pending`,
 * `declined`, `signed`). The missing distinction is the one the operator acts
 * on: a rider who has opened the document and not signed it is stalling, and a
 * rider who has not opened it has not seen it at all, so one gets a reminder
 * and the other needs a phone call. `viewed_at` carries that fact, which is why
 * `20260901100000` added the column and why `driver_mark_esign_viewed` stamps
 * it only once the signed URL resolves — a `viewed_at` that could be set by a
 * failed preview would put the wrong riders in the "already seen it" bucket.
 *
 * Derived on read rather than stored, deliberately. A stored stage would need
 * a trigger on every one of the four transitions and would be wrong for any row
 * written before the trigger existed; the inputs are three columns on the row
 * already in hand, so there is nothing to keep in sync.
 */

/** The four recipient states the tracker draws, plus the two terminal others. */
export type EsignRecipientStage =
  | "signed"
  | "declined"
  | "opened"
  | "not_opened"
  | "expired"
  | "cancelled";

/**
 * Stages that still need the recipient to act, which is exactly the set a
 * reminder is allowed to reach. Mirrors the RPC's own skip list in
 * `admin_remind_esign_requests` — the server is the lock, and this keeps the
 * button from being offered where the server would count it as a no-op.
 */
export const ESIGN_REMINDABLE_STAGES: EsignRecipientStage[] = [
  "not_opened",
  "opened",
];

export function isEsignRemindable(stage: EsignRecipientStage): boolean {
  return ESIGN_REMINDABLE_STAGES.includes(stage);
}

/**
 * Narrowing guard for a wire value.
 *
 * `recipient_stage` arrives from PostgREST as a plain string, and the tracker's
 * stage switch is exhaustive over the union — so a value this file has not
 * heard of has to be *dropped* rather than cast into the union, or a newly added
 * server state would land in the switch's default branch with no type error to
 * flag it. Callers fall back to `esignRecipientStage`, which reads the row.
 */
export function isEsignRecipientStage(value: unknown): value is EsignRecipientStage {
  return (
    typeof value === "string" &&
    (
      ["signed", "declined", "opened", "not_opened", "expired", "cancelled"] as const
    ).includes(value as EsignRecipientStage)
  );
}

/**
 * A reminder is a notification, so it is rate-limited per recipient rather than
 * per batch: re-sending to the same rider because a colleague was added to the
 * batch is the behaviour riders complain about. 24h matches the server's own
 * ledger window and is a whole day of the operator's mental model.
 */
export const ESIGN_REMIND_COOLDOWN_HOURS = 24;

/**
 * Hours left before a recipient may be reminded again, 0 when they may be
 * reminded now.
 *
 * Returns 0 rather than null for "never reminded" so the caller has one number
 * to test, and reads `nowMs` as a parameter so the rule is a pure function of
 * its inputs — a client clock read inside would make the call untestable and
 * would make the drawer's countdown disagree with the table's disabled state by
 * however long the two renders were apart.
 */
export function remindCooldownHoursLeft(
  lastRemindedAt: string | null,
  nowMs: number,
): number {
  if (!lastRemindedAt) return 0;
  const at = Date.parse(lastRemindedAt);
  if (Number.isNaN(at)) return 0;
  const elapsedHours = (nowMs - at) / 3_600_000;
  const left = ESIGN_REMIND_COOLDOWN_HOURS - elapsedHours;
  return left > 0 ? left : 0;
}

/**
 * The recipient's stage.
 *
 * `status` is read as the *effective* status the list already resolved, so an
 * overdue pending row arrives as `expired` and lands in its own bucket instead
 * of being counted as still-waiting. Anything unrecognised falls to the
 * `viewed_at` test rather than to a default, because a status this file has not
 * heard of is far more likely to be a new in-flight state than a finished one.
 */
export function esignRecipientStage(row: {
  status: string;
  viewed_at: string | null;
}): EsignRecipientStage {
  const status = (row.status ?? "").trim().toLowerCase();
  if (status === "signed") return "signed";
  if (status === "declined") return "declined";
  if (status === "cancelled") return "cancelled";
  if (status === "expired") return "expired";
  return row.viewed_at ? "opened" : "not_opened";
}

/** Per-batch totals the tracker's progress cell and tabs are built from. */
export type EsignBatchProgress = {
  total: number;
  signed: number;
  declined: number;
  /** Opened and not signed. */
  opened: number;
  /** Not opened at all. */
  notOpened: number;
  /** Anything outside the four drawn states — expired and cancelled. */
  other: number;
  /** How far the batch has got, 0–100, rounded. */
  percent: number;
};

export function esignBatchProgress(
  rows: { status: string; viewed_at: string | null; stage?: EsignRecipientStage }[],
  /**
   * Rows the batch intends to send, when that is larger than `rows.length`.
   *
   * The batch detail holds every uploaded row but only the dispatched ones have
   * a recipient to describe, and "5 of 40 signed" is the honest reading of a
   * batch where ten rows never produced a document. Without this the denominator
   * would silently shrink to the rows that happened to work, and a batch that
   * half-failed would look further along than it is.
   */
  totalOverride?: number,
): EsignBatchProgress {
  const progress: EsignBatchProgress = {
    total: totalOverride ?? rows.length,
    signed: 0,
    declined: 0,
    opened: 0,
    notOpened: 0,
    other: 0,
    percent: 0,
  };
  for (const row of rows) {
    // `stage` wins when present: the batch detail derives it from the same
    // `esign_requests` embed it draws, expiry applied, and re-deriving it here
    // from a raw status would let the progress bar describe a different state
    // than the stage column beside it.
    switch (row.stage ?? esignRecipientStage(row)) {
      case "signed":
        progress.signed += 1;
        break;
      case "declined":
        progress.declined += 1;
        break;
      case "opened":
        progress.opened += 1;
        break;
      case "not_opened":
        progress.notOpened += 1;
        break;
      default:
        progress.other += 1;
    }
  }
  // A batch with no recipients is 0%, not NaN and not 100%. It cannot happen
  // through the UI — a batch is created from at least one sheet row — but a
  // divide that a zero-row batch can reach is the same trap the payroll
  // efficiency bands already fell into once.
  progress.percent =
    progress.total === 0
      ? 0
      : Math.round((progress.signed / progress.total) * 100);
  return progress;
}

/**
 * The batch's own status, which is a statement about its recipients and not
 * about the dispatch.
 *
 * `esign_batches.status` tracks the *upload* — `queued` / `processing` /
 * `completed` / `partial` — and a batch whose every row was dispatched
 * successfully still reads `completed` while nobody has signed anything. The
 * tracker's `In progress` / `Completed` / `Has declines` / `Waiting` is a
 * different question, so it is derived from the recipients.
 *
 * Precedence, and each step is a decision:
 * - a decline outranks completion, because a batch with one refusal needs the
 *   operator's attention even when everything else came back signed;
 * - completed means every recipient signed, so a batch with a decline is never
 *   also "completed" — the decline is the row that matters;
 * - in-progress needs at least one signature, otherwise a batch nobody has
 *   touched reads as started.
 */
export type EsignBatchStage =
  | "waiting"
  | "in_progress"
  | "completed"
  | "has_declines";

export function esignBatchStage(progress: EsignBatchProgress): EsignBatchStage {
  if (progress.declined > 0) return "has_declines";
  if (progress.total > 0 && progress.signed >= progress.total) return "completed";
  if (progress.signed > 0) return "in_progress";
  return "waiting";
}
