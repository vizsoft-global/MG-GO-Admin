import type {
  NOTIFICATION_ACTION_TYPES,
  NOTIFICATION_AUTOMATION_TRIGGERS,
  NOTIFICATION_CAMPAIGN_STATUSES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_TARGET_MODES,
} from "./constants";

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];
export type NotificationActionType = (typeof NOTIFICATION_ACTION_TYPES)[number];
export type NotificationTargetMode = (typeof NOTIFICATION_TARGET_MODES)[number];
export type NotificationCampaignStatus = (typeof NOTIFICATION_CAMPAIGN_STATUSES)[number];
export type NotificationAutomationTrigger = (typeof NOTIFICATION_AUTOMATION_TRIGGERS)[number];

export type TargetSpec = {
  mode: NotificationTargetMode;
  zone_ids?: string[];
  partner_ids?: string[];
  role_ids?: string[];
  statuses?: string[];
  team_ids?: string[];
  group_ids?: string[];
  driver_ids?: string[];
  dynamic_rules?: Record<string, unknown>[];
};

export type NotificationImportRow = Record<string, string>;

export type NotificationImportSpec = {
  column_mapping: Partial<Record<string, string>>;
  variable_columns: string[];
  rows: NotificationImportRow[];
};

export type ExclusionSpec = {
  driver_ids?: string[];
  zone_ids?: string[];
  partner_ids?: string[];
  statuses?: string[];
};

export type ActionPayload = {
  action_type: NotificationActionType;
  action_params: Record<string, unknown>;
  deep_link?: string | null;
  payload_version: number;
};

export type ScheduleSpec = {
  mode: "now" | "later" | "recurring";
  scheduled_for?: string | null;
  recurring_rule?: string | null;
  campaign_window_start?: string | null;
  campaign_window_end?: string | null;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  send_limit?: number | null;
};

export type NotificationMediaItem = {
  role: "banner" | "image";
  type: "image";
  object_key: string;
  alt?: string;
};

export type NotificationCampaignRow = {
  id: string;
  title: string;
  body: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  status: NotificationCampaignStatus;
  template_id: string | null;
  target_spec: TargetSpec;
  exclusion_spec: ExclusionSpec;
  action_type: NotificationActionType;
  action_params: Record<string, unknown>;
  payload_version: number;
  media: NotificationMediaItem[];
  schedule_spec: ScheduleSpec;
  timezone: string;
  scheduled_for: string | null;
  expires_at: string | null;
  requires_approval: boolean;
  approved_at: string | null;
  sent_at: string | null;
  estimated_audience_count: number;
  recipient_count: number;
  delivered_count: number;
  opened_count: number;
  clicked_count: number;
  failed_count: number;
  import_spec?: NotificationImportSpec;
  track_engagement?: boolean;
  /** Tri-state: null = inherit template, true = force on, false = force off */
  screenshot_restricted_override: boolean | null;
  /** Resolved stamp sent to driver app */
  screenshot_restricted: boolean;
  created_at: string;
  updated_at: string;
};

export type NotificationTemplateRow = {
  id: string;
  name: string;
  description: string | null;
  category: NotificationCategory;
  priority: NotificationPriority;
  title_template: string;
  body_template: string;
  variable_schema: unknown[];
  action_type: NotificationActionType;
  action_params: Record<string, unknown>;
  payload_version: number;
  screenshot_restricted: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};

export type NotificationScreenshotEventRow = {
  id: string;
  campaign_id: string;
  dispatch_item_id: string | null;
  driver_id: string;
  occurred_at: string;
  metadata: Record<string, unknown>;
  driver_code?: string | null;
  driver_name?: string | null;
};

export type NotificationAutomationRow = {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "paused" | "archived";
  trigger_type: NotificationAutomationTrigger;
  trigger_config: Record<string, unknown>;
  condition_spec: Record<string, unknown>;
  target_spec: TargetSpec;
  exclusion_spec: ExclusionSpec;
  template_id: string | null;
  title_template: string | null;
  body_template: string | null;
  category: NotificationCategory;
  priority: NotificationPriority;
  action_type: NotificationActionType;
  action_params: Record<string, unknown>;
  throttle_minutes: number;
  cooldown_minutes: number;
  max_retries: number;
  consecutive_failures: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
};

export type NotificationAnalyticsDailyRow = {
  metric_date: string;
  campaign_id: string;
  sent_count: number;
  delivered_count: number;
  opened_count: number;
  clicked_count: number;
  failed_count: number;
  campaign?: { title: string; category: NotificationCategory } | null;
};

export type NotificationDashboardKpis = {
  sentToday: number;
  scheduled: number;
  drafts: number;
  deliveryRate: number;
  failedDeliveries: number;
  openRate: number;
  activeAutomations: number;
  recentActivity: number;
};

export type NotificationListFilters = {
  status?: string;
  category?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
};

export type NotificationActionError =
  | "not_authorized"
  | "not_found"
  | "invalid_input"
  | "approval_required"
  | "empty_audience"
  | "empty_recipients"
  | "dispatch_failed"
  | "save_failed";

export type SaveCampaignInput = {
  title: string;
  body: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  templateId?: string | null;
  targetSpec: TargetSpec;
  exclusionSpec?: ExclusionSpec;
  actionType: NotificationActionType;
  actionParams?: Record<string, unknown>;
  media?: NotificationMediaItem[];
  scheduleSpec: ScheduleSpec;
  timezone?: string;
  expiresAt?: string | null;
  sendLimit?: number | null;
  importSpec?: NotificationImportSpec;
  trackEngagement?: boolean;
  /** Tri-state: null/undefined = inherit template */
  screenshotRestrictedOverride?: boolean | null;
};

export type SaveTemplateInput = {
  name: string;
  description?: string | null;
  category: NotificationCategory;
  priority: NotificationPriority;
  titleTemplate: string;
  bodyTemplate: string;
  variableSchema?: unknown[];
  actionType: NotificationActionType;
  actionParams?: Record<string, unknown>;
  screenshotRestricted?: boolean;
};

export type SaveAutomationInput = {
  name: string;
  description?: string | null;
  triggerType: NotificationAutomationTrigger;
  triggerConfig?: Record<string, unknown>;
  conditionSpec?: Record<string, unknown>;
  targetSpec?: TargetSpec;
  exclusionSpec?: ExclusionSpec;
  templateId?: string | null;
  titleTemplate?: string | null;
  bodyTemplate?: string | null;
  category: NotificationCategory;
  priority: NotificationPriority;
  actionType?: NotificationActionType;
  actionParams?: Record<string, unknown>;
  throttleMinutes?: number;
  cooldownMinutes?: number;
  maxRetries?: number;
};

/** @deprecated Use NotificationCampaignRow */
export type NotificationCampaign = NotificationCampaignRow & {
  name?: string;
  lifecycle_state?: string;
  audience_estimate?: number;
  send_at?: string | null;
};

/** @deprecated Use NotificationTemplateRow */
export type NotificationTemplate = NotificationTemplateRow & {
  key?: string;
  version?: number;
  is_active?: boolean;
};

/** @deprecated Use NotificationAutomationRow */
export type NotificationAutomation = NotificationAutomationRow & {
  trigger_key?: string;
  cooldown_seconds?: number;
  throttle_per_hour?: number;
  max_retries?: number;
  last_run_at?: string | null;
};

export type NotificationDashboardMetrics = NotificationDashboardKpis & {
  pendingApproval?: number;
};
