export const NOTIFICATION_CATEGORIES = [
  "incentive",
  "reminder",
  "compliance",
  "attendance",
  "salary",
  "emergency",
  "announcement",
  "operations",
  "system_alert",
] as const;

export const NOTIFICATION_PRIORITIES = ["low", "normal", "high", "critical"] as const;

export const NOTIFICATION_ACTION_TYPES = [
  "open_screen",
  "open_module",
  "open_record",
  "open_workflow",
  "open_url",
  "custom_payload",
  "silent_update_trigger",
] as const;

export const NOTIFICATION_TARGET_MODES = [
  "all",
  "zone",
  "partner",
  "role",
  "status",
  "team",
  "group",
  "custom",
  "import",
  "dynamic",
] as const;

/** Target modes with working admin UI + audience RPC support. */
export const NOTIFICATION_SUPPORTED_TARGET_MODES = [
  "all",
  "zone",
  "partner",
  "status",
  "group",
  "custom",
  "import",
] as const;

export const NOTIFICATION_MAX_RECIPIENTS = 5000;

export const NOTIFICATION_CAMPAIGN_STATUSES = [
  "draft",
  "pending_approval",
  "scheduled",
  "queued",
  "processing",
  "sent",
  "delivered",
  "opened",
  "clicked",
  "failed",
  "cancelled",
  "expired",
] as const;

export const NOTIFICATION_AUTOMATION_TRIGGERS = [
  "inactivity",
  "attendance_approved",
  "salary_processed",
  "document_expiry",
  "low_performance",
  "incentive_unlocked",
  "shift_reminder",
  "missed_submission",
  "schedule",
] as const;

export const APPROVAL_REQUIRED_CATEGORIES = new Set(["emergency"]);
export const APPROVAL_REQUIRED_PRIORITIES = new Set(["high", "critical"]);

export function requiresApproval(input: {
  category: string;
  priority: string;
  targetMode: string;
}): boolean {
  return (
    APPROVAL_REQUIRED_CATEGORIES.has(input.category) ||
    APPROVAL_REQUIRED_PRIORITIES.has(input.priority) ||
    input.targetMode === "all"
  );
}

export const DEFAULT_TIMEZONE = "Asia/Kuwait";
export const PAYLOAD_VERSION = 2;

export const NOTIFICATIONS_CAMPAIGNS_PAGE_SIZE = 20;
