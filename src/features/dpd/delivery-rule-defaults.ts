import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";

/**
 * The window a **new** delivery rule opens with: today (Asia/Kuwait) through the
 * same day next year.
 *
 * The server accepts any window, but an operator who leaves both dates blank has
 * already said what they mean — "live from today" — and asking them to retype it
 * is how a rule gets saved with last month's start date. Editing an existing rule
 * always keeps the stored window.
 */
export function defaultDeliveryRuleWindow(today: string = kuwaitTodayYmd()): {
  startDate: string;
  endDate: string;
} {
  const [year, month, day] = today.split("-").map(Number);
  const nextYear = year + 1;
  // 29 Feb → 28 Feb in a non-leap year, instead of rolling into March.
  const lastDayOfMonth = new Date(Date.UTC(nextYear, month, 0)).getUTCDate();
  const safeDay = Math.min(day, lastDayOfMonth);
  return {
    startDate: today,
    endDate: `${nextYear}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`,
  };
}
