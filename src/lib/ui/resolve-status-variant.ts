export type StatusVariant = "success" | "warning" | "danger" | "neutral";

const SUCCESS_STATUSES = new Set([
  "active",
  "approved",
  "completed",
  "delivered",
  "verified",
  "published",
  "success",
  "paid",
  "on_duty",
  "on-duty",
  "available",
  "sent",
  "enabled",
  "connected",
  "healthy",
  "present",
  "matched",
  "online",
  "working",
  "opened",
  "clicked",
]);

const WARNING_STATUSES = new Set([
  "pending",
  "waiting",
  "review",
  "reviewing",
  "scheduled",
  "idle",
  "paused",
  "partial",
  "expiring",
  "warning",
  "in_progress",
  "processing",
  "late",
  "surplus",
  "deficit",
  "silent",
  "missing",
  "awaiting_verification",
  "override_pending",
  "pending_approval",
  "queued",
]);

const DANGER_STATUSES = new Set([
  "inactive",
  "rejected",
  "failed",
  "error",
  "blocked",
  "cancelled",
  "canceled",
  "suspended",
  "archived",
  "offline",
  "alert",
  "overdue",
  "expired",
  "disabled",
  "deleted",
  "absent",
  "conflict",
  "admin_forced",
]);

/** Intake/workflow drafts — neutral until submitted. */
const NEUTRAL_STATUSES = new Set(["draft", "on_leave", "under_review", "signed_out"]);

/** Single canonical status → pill variant mapper for the admin panel. */
export function resolveStatusVariant(status: string | null | undefined): StatusVariant {
  if (!status) return "neutral";

  const normalized = status.trim().toLowerCase().replace(/\s+/g, "_");

  if (NEUTRAL_STATUSES.has(normalized)) return "neutral";
  if (SUCCESS_STATUSES.has(normalized)) return "success";
  if (WARNING_STATUSES.has(normalized)) return "warning";
  if (DANGER_STATUSES.has(normalized)) return "danger";

  return "neutral";
}

/** Map status to semantic MetricTile/Pill tone. */
export function resolveStatusTone(status: string | null | undefined) {
  const variant = resolveStatusVariant(status);
  switch (variant) {
    case "success":
      return "success" as const;
    case "warning":
      return "warning" as const;
    case "danger":
      return "danger" as const;
    default:
      return "neutral" as const;
  }
}
