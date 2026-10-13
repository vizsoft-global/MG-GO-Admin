/**
 * Pure money-engine helpers: calendar rules, the company scheme, and rounding.
 *
 * Kept free of Firestore so the arithmetic that decides a rider's pay can be
 * tested without a database — the same reason `payroll-rules-engine.ts` lives
 * outside the React tree. Every function here is a port of a SQL function of the
 * same name, and the port is literal on purpose: `compute_source_company_incentive`
 * is what the SOP spreadsheet computes, so a "cleaner" rewrite would be a
 * different payout presented as the same one.
 */

import { KUWAIT_OFFSET_MS } from "./kuwait";

const DAY_MS = 24 * 60 * 60 * 1000;

export type IncentivePeriod = "daily" | "weekly" | "monthly";
export type IncentiveTargetMode = "single" | "tiered";
export type IncentiveRewardMode = "fixed" | "per_delivery";
export type IncentivePayoutMode = "per_tier" | "cumulative";
export type RuleScopeType = "zone" | "partner" | "restaurant";
export type RuleStatus = "draft" | "active" | "ended";
export type WalletEntryStatus = "approved" | "pending" | "voided";
export type DeliveryStatus =
  | "pending"
  | "in_transit"
  | "under_review"
  | "verified"
  | "rejected"
  | "cancelled";

/** `KWD` is stored at 3 decimals everywhere in this schema, so every amount rounds here. */
const KWD_DECIMALS = 3;

export function roundKwd(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** KWD_DECIMALS;
  return Math.round(value * factor) / factor;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function parseDay(day: string): number {
  const [y, m, d] = day.split("-").map((part) => Number(part));
  return Date.UTC(y, m - 1, d);
}

function dayString(utcMs: number): string {
  const shifted = new Date(utcMs + KUWAIT_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

function addDays(day: string, days: number): string {
  return dayString(parseDay(day) + days * DAY_MS - KUWAIT_OFFSET_MS);
}

/**
 * `kuwait_week_start`: `p_date - ((ISODOW + 6) % 7)`.
 *
 * That arithmetic is the ISO Monday week — Saturday lands 5 days back on Monday
 * and Sunday 6 — so this is not the Sat–Fri fuel log week, and pretending the
 * two are the same would move a weekly payout by up to six days.
 */
export function kuwaitWeekStart(day: string): string {
  const isoDow = new Date(parseDay(day)).getUTCDay(); // 0 = Sunday
  const iso = isoDow === 0 ? 7 : isoDow;
  return addDays(day, -((iso + 6) % 7));
}

export function kuwaitWeekEnd(day: string): string {
  return addDays(kuwaitWeekStart(day), 6);
}

export function kuwaitMonthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function kuwaitMonthEnd(day: string): string {
  const [y, m] = day.split("-").map((part) => Number(part));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return dayString(Date.UTC(y, m - 1, lastDay) - KUWAIT_OFFSET_MS);
}

/**
 * `incentive_accrues_on_date`: a weekly rule only pays on the last day of its
 * week, a monthly rule on the last day of its month.
 *
 * The earnings row is written per day, so without this the week's whole bonus
 * would be written onto every day of the week.
 */
export function incentiveAccruesOnDate(period: IncentivePeriod, earnDate: string): boolean {
  switch (period) {
    case "daily":
      return true;
    case "weekly":
      return earnDate === kuwaitWeekEnd(earnDate);
    case "monthly":
      return earnDate === kuwaitMonthEnd(earnDate);
    default: {
      const exhaustive: never = period;
      return exhaustive;
    }
  }
}

export function periodStart(period: IncentivePeriod, earnDate: string): string {
  switch (period) {
    case "daily":
      return earnDate;
    case "weekly":
      return kuwaitWeekStart(earnDate);
    case "monthly":
      return kuwaitMonthStart(earnDate);
    default: {
      const exhaustive: never = period;
      return exhaustive;
    }
  }
}

export type CompanyScheme = {
  incentive_kwd: number;
  deduction_kwd: number;
  net_kwd: number;
};

/**
 * `compute_source_company_incentive` — the flat above/below scheme the SOP
 * spreadsheet uses for an outsourced company.
 *
 * `net_kwd` is signed (negative below target) while `incentive_kwd` and
 * `deduction_kwd` are both non-negative, because the ledger prints the two sides
 * separately and only the net is what the rider is paid.
 */
export function computeSourceCompanyIncentive(
  orders: number,
  target: number,
  above: number | null,
  below: number | null,
): CompanyScheme {
  const safeOrders = Number.isFinite(orders) ? orders : 0;
  const safeTarget = Number.isFinite(target) ? target : 0;
  const aboveRate = Number.isFinite(above as number) ? (above as number) : 0;
  const belowRate = Number.isFinite(below as number) ? (below as number) : 0;

  const incentive = safeOrders > safeTarget ? (safeOrders - safeTarget) * aboveRate : 0;
  const deduction = safeOrders < safeTarget ? (safeTarget - safeOrders) * belowRate : 0;
  const net =
    safeOrders > safeTarget
      ? (safeOrders - safeTarget) * aboveRate
      : safeOrders < safeTarget
        ? -((safeTarget - safeOrders) * belowRate)
        : 0;

  return {
    incentive_kwd: roundKwd(incentive),
    deduction_kwd: roundKwd(deduction),
    net_kwd: roundKwd(net),
  };
}
