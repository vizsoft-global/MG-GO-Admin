export const WRONG_ACTION_TYPES = [
  "delay",
  "zone_breach",
  "hygiene_failed",
  "uniform",
  "other",
] as const;

export const WRONG_ACTION_SEVERITIES = ["low", "medium", "high"] as const;

export const WRONG_ACTION_SOURCES = ["system", "admin"] as const;

export type WrongActionType = (typeof WRONG_ACTION_TYPES)[number];
export type WrongActionSeverity = (typeof WRONG_ACTION_SEVERITIES)[number];
export type WrongActionSource = (typeof WRONG_ACTION_SOURCES)[number];

/**
 * Severity is scored, not just displayed. These are the same weights the
 * `conduct` component applies in `performance_daily_source`, kept here so the
 * list can show a driver what their incidents are worth without a round trip.
 * A change to one is a change to both.
 */
export const WRONG_ACTION_SEVERITY_WEIGHT: Record<WrongActionSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export type WrongActionRow = {
  id: string;
  driver_id: string;
  action_type: WrongActionType;
  severity: WrongActionSeverity;
  details: string | null;
  occurred_at: string;
  source: WrongActionSource;
  created_at: string;
  created_by: string | null;
  driver_name: string | null;
  driver_code: string | null;
  driver_zone_name: string | null;
  created_by_name: string | null;
};
