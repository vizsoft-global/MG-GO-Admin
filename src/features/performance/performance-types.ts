export type PerformanceHubTab = "period" | "live" | "analysis";

/**
 * Components blended into the compliance pillar. Keys are locked — SQL keys on
 * them, so a rename would silently orphan a component's weight and history.
 */
export const PERFORMANCE_COMPONENT_KEYS = [
  "punctuality",
  "duty_ratio",
  "on_time",
  "speed",
  "zone",
  "gps",
  "conduct",
] as const;

export type PerformanceComponentKey =
  (typeof PERFORMANCE_COMPONENT_KEYS)[number];

export type PerformanceComponent = {
  key: PerformanceComponentKey;
  label_en: string;
  label_ar: string;
  weight: number;
  sort_order: number;
  is_active: boolean;
};

/**
 * Per-driver component ratios in [0,1]. A key is absent when the period held no
 * data for it — absent and 0 are different facts, which is the whole reason the
 * blend renormalises instead of substituting a zero.
 */
export type PerformanceComponentScores = Partial<
  Record<PerformanceComponentKey, number>
>;

export type PerformanceComponentSettings = {
  /**
   * Pickup-to-delivered budget. Deliberately not a customer promise: allocation
   * is external, so no ETA exists anywhere in this schema.
   */
  delivery_ontime_minutes: number;
  /** Per worked day, so the score does not move with the width of the filter. */
  speed_allowance_per_day: number;
  conduct_allowance_per_day: number;
};

/** One rolled-up day for one driver, with the blend opened up. */
export type PerformanceDailyRow = {
  log_date: string;
  worked: boolean;
  on_leave: boolean;
  absent: boolean;
  /** Null when the day held nothing measurable — never 0. */
  compliance_score: number | null;
  component_scores: PerformanceComponentScores;
  deliveries_completed: number | null;
  deliveries_within_sla: number | null;
  overspeed_events: number | null;
  /**
   * Sources that had data when the row was written. A missing source means the
   * component is unknown for that day, which is why the UI can say so instead of
   * drawing an absence as compliance.
   */
  sources_complete: string[];
};

export type PerformanceDailyResult = {
  rows: PerformanceDailyRow[];
  components: PerformanceComponent[];
  from: string;
  to: string;
};

export type PerformanceSortKey =
  | "overall_desc"
  | "overall_asc"
  | "delivery_desc"
  | "delivery_asc"
  | "utilization_desc"
  | "utilization_asc"
  | "compliance_desc"
  | "compliance_asc"
  | "manual_desc"
  | "manual_asc"
  | "name_asc"
  | "name_desc";

export type PerformanceScoreWeights = {
  delivery: number;
  utilization: number;
  compliance: number;
  /** Fleet / HR / Operations rating. 0 = the rating does not move any score. */
  manual: number;
  exception_penalty: number;
};

export const DEFAULT_PERFORMANCE_WEIGHTS: PerformanceScoreWeights = {
  delivery: 1,
  utilization: 1,
  compliance: 1,
  manual: 0,
  exception_penalty: 5,
};

/** 1–5 onto 0–100 with the midpoint preserved: 3 of 5 is average, so it is 50. */
export function manualRatingToScore(rating: number): number {
  if (!Number.isFinite(rating)) return 0;
  const clamped = Math.min(5, Math.max(1, rating));
  return Math.round(((clamped - 1) / 4) * 1000) / 10;
}

/**
 * The inverse, so a list cell can show the 1–5 a rater actually picked rather
 * than the normalised score the formula uses.
 */
export function scoreToStars(score: number): number {
  if (!Number.isFinite(score)) return 1;
  const clamped = Math.min(100, Math.max(0, score));
  return Math.round(((clamped / 100) * 4 + 1) * 10) / 10;
}

export type PerformanceListFilters = {
  search?: string;
  partnerId?: string;
  zoneId?: string;
  restaurantId?: string;
  driverStatus?: string;
  fromDate?: string;
  toDate?: string;
  sort?: PerformanceSortKey;
  page?: number;
  pageSize?: number;
  driverId?: string;
};

/** Score bands, widest first. Thresholds mirror admin_list_driver_performance. */
export type PerformanceScoreBand = "top" | "good" | "watch" | "critical";

export const PERFORMANCE_BAND_FLOOR: Record<PerformanceScoreBand, number> = {
  top: 80,
  good: 70,
  watch: 50,
  critical: 0,
};

export function performanceBand(score: number): PerformanceScoreBand {
  if (!Number.isFinite(score)) return "critical";
  if (score >= PERFORMANCE_BAND_FLOOR.top) return "top";
  if (score >= PERFORMANCE_BAND_FLOOR.good) return "good";
  if (score >= PERFORMANCE_BAND_FLOOR.watch) return "watch";
  return "critical";
}

export type PerformanceExceptionSummary = {
  exception_type: string;
  exception_date: string;
  severity: string;
  resolution_status: string | null;
};

/** Mirrors the CHECK on driver_performance_ratings.score. */
export const RATING_SCALE_MAX = 5;

export type PerformanceManualTeamScore = {
  team_key: string;
  /** Team average on the 1–5 scale across the months the range covers. */
  score: number;
  months_rated: number;
  last_rated_at: string | null;
};

export type PerformanceDriverRow = {
  driver_id: string;
  driver_code: string;
  employee_id: string | null;
  driver_name: string;
  driver_phone: string;
  driver_status: string;
  partner_id: string | null;
  partner_name: string | null;
  zone_id: string | null;
  zone_name: string | null;
  is_on_duty: boolean;
  worked_days: number;
  leave_days: number;
  absent_days: number;
  eligible_days: number;
  period_days: number;
  actual_deliveries: number;
  target_deliveries: number;
  rule_id: string | null;
  incentive_period: string | null;
  rule_target: number;
  delivery_efficiency: number;
  delivery_efficiency_raw: number;
  utilization: number;
  /**
   * The component blend. Null when no component could be measured — a driver
   * nobody has data on is not a driver who scored zero.
   */
  compliance_score: number | null;
  /** The pre-component number, kept so the settings preview can show old vs new. */
  legacy_compliance_score: number | null;
  component_scores: PerformanceComponentScores;
  exception_count: number;
  /** Only the types no component measures still cost points. */
  penalised_exception_count: number;
  exceptions: PerformanceExceptionSummary[];
  /** Null when no active team has rated this driver in the period. */
  manual_score: number | null;
  /** Number of teams holding a rating, not the number of rating rows. */
  manual_rating_count: number;
  manual_teams: PerformanceManualTeamScore[];
  overall_score: number;
  /** Rank across the filtered fleet by score — not the row position. */
  dpd_rank: number;
  score_band: PerformanceScoreBand;
};

export type PerformanceKpis = {
  avg_overall: number | null;
  avg_delivery_pct: number | null;
  avg_utilization_pct: number | null;
  avg_compliance: number | null;
  /** The same fleet under the pre-component rule, for the settings preview. */
  avg_legacy_compliance?: number | null;
  below_threshold: number;
  top_score: number | null;
  bottom_score: number | null;
  top_driver_name: string | null;
  bottom_driver_name: string | null;
  band_top: number;
  band_good: number;
  band_watch: number;
  band_critical: number;
  /** Averaged over rated drivers only — otherwise it would measure coverage. */
  avg_manual: number | null;
  rated_drivers: number;
};

export type PerformanceRatingTeamRow = {
  team_key: string;
  label_en: string;
  label_ar: string;
  weight: number;
  score: number | null;
  comment: string | null;
  rated_at: string | null;
  rated_by: string | null;
  rated_by_name: string | null;
  /** Decided by the server from team membership, never by the client. */
  can_edit: boolean;
};

export type PerformanceRatingPanel = {
  driver_id: string;
  period_month: string;
  teams: PerformanceRatingTeamRow[];
};

export type PerformanceTeamMember = {
  profile_id: string;
  full_name: string;
  email: string | null;
};

export type PerformanceRatingTeamConfig = {
  key: string;
  label_en: string;
  label_ar: string;
  weight: number;
  sort_order: number;
  is_active: boolean;
  members: PerformanceTeamMember[];
};

export type PerformanceListResult = {
  rows: PerformanceDriverRow[];
  totalCount: number;
  kpis: PerformanceKpis;
  weights: PerformanceScoreWeights;
  /** Active components in display order, so a column exists even for an unmeasured one. */
  components: PerformanceComponent[];
  slaMinutes: number;
  from: string;
  to: string;
  /** Server-side row ceiling for one export call. */
  maxExportRows: number;
};

export type PerformanceReportTeam = {
  key: string;
  label: string;
};

export type PerformanceReport = {
  from: string;
  to: string;
  rows: PerformanceDriverRow[];
  kpis: PerformanceKpis;
  weights: PerformanceScoreWeights;
  /**
   * Active rating teams in display order, so the workbook has one column per
   * team even for a team that rated nobody in the period — a missing column
   * and an unrated fleet are different facts.
   */
  ratingTeams: PerformanceReportTeam[];
  /**
   * Active score components, for the same reason: a component nobody could be
   * measured on still gets a column, so a blank column reads as no data rather
   * than as a component that was never configured.
   */
  components: PerformanceComponent[];
  /** True when the fleet is larger than one export can carry. */
  truncated: boolean;
  totalCount: number;
};

export type DpdLiveBreakdownRow = {
  /** Null means unassigned — a real bucket, not a missing row. */
  id: string | null;
  label: string | null;
  deliveries: number;
  on_duty: number;
};

export type DpdLiveLeaderRow = {
  driver_id: string;
  driver_name: string;
  driver_code: string;
  zone_name: string | null;
  partner_name: string | null;
  is_on_duty: boolean;
  submitted: number;
  verified: number;
  in_transit: number;
};

export type DpdLiveSnapshot = {
  date: string;
  generated_at: string;
  deliveries: {
    created: number;
    in_transit: number;
    pending: number;
    under_review: number;
    verified: number;
    rejected: number;
    cancelled: number;
  };
  roster: {
    active_drivers: number;
    total_drivers: number;
    on_duty: number;
    tracking_live: number;
    checked_in: number;
  };
  alerts: {
    out_of_zone: number;
    gps_offline: number;
    low_battery: number;
  };
  leaderboard: DpdLiveLeaderRow[];
  zones: DpdLiveBreakdownRow[];
  partners: DpdLiveBreakdownRow[];
  score: PerformanceKpis;
};

export type RecentDeliveryFeedItem = {
  id: string;
  driver_id: string | null;
  driver_name: string;
  driver_code: string;
  status: string;
  partner_name: string | null;
  zone_name: string | null;
  delivered_at: string | null;
  created_at: string;
};
