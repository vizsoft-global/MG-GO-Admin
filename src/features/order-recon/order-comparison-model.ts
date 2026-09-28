export const COMPARISON_RESULTS = [
  "match",
  "am_higher",
  "mggo_higher",
  "not_using_app",
  "mggo_only",
] as const;

export type ComparisonResult = (typeof COMPARISON_RESULTS)[number] | "no_orders";

export type ComparisonDayCount = {
  mg_id: string;
  work_date: string;
  orders: number;
  rider_name?: string | null;
};

export type ComparisonRiderMeta = {
  mg_id: string;
  driver_id?: string | null;
  rider_name: string;
  restaurant_name: string;
};

export type ComparisonSnapshot = {
  from: string;
  to: string;
  am: ComparisonDayCount[];
  mggo: ComparisonDayCount[];
  riders: ComparisonRiderMeta[];
};

export type ComparisonRider = {
  mgId: string;
  name: string;
  restaurant: string;
  am: number;
  mggo: number;
  amDays: number[];
  mggoDays: number[];
  diffDays: number[];
  diff: number;
  diffPct: number | null;
  offDays: number;
  workedDays: number;
  result: ComparisonResult;
};

export type ComparisonResultCard = {
  result: Exclude<ComparisonResult, "no_orders">;
  count: number;
  share: number;
  am: number;
  mggo: number;
};

export type ComparisonKpis = {
  riders: number;
  am: number;
  mggo: number;
  net: number;
  matches: number;
  matchRate: number;
  cards: ComparisonResultCard[];
};

export type ComparisonDailyPoint = {
  date: string;
  day: number;
  am: number;
  mggo: number;
  diff: number;
  ridersOff: number;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function normalizeMgId(raw: string | number | null | undefined): string {
  if (raw == null) return "";
  if (typeof raw === "number" && Number.isFinite(raw)) return String(Math.trunc(raw));
  const text = String(raw).trim().toLowerCase();
  if (!text) return "";
  if (/^\d+\.0+$/.test(text)) return text.replace(/\.0+$/, "");
  return text;
}

export function displayMgId(raw: string | number | null | undefined): string {
  if (raw == null) return "";
  if (typeof raw === "number" && Number.isFinite(raw)) return String(Math.trunc(raw));
  const text = String(raw).trim();
  if (/^\d+\.0+$/.test(text)) return text.replace(/\.0+$/, "");
  return text;
}

export function comparisonResult(am: number, mggo: number): ComparisonResult {
  if (am === 0 && mggo === 0) return "no_orders";
  if (am === mggo) return "match";
  if (mggo === 0) return "not_using_app";
  if (am === 0) return "mggo_only";
  return am > mggo ? "am_higher" : "mggo_higher";
}

export function diffTint(diff: number): { bg: string; fg: string } {
  if (!diff) return { bg: "", fg: "" };
  const abs = Math.abs(diff);
  if (diff > 0) {
    if (abs >= 5) return { bg: "#6f8cee", fg: "#fff" };
    if (abs >= 2) return { bg: "#a9baf5", fg: "#1e3a9e" };
    return { bg: "#dbe3fb", fg: "#1e3a9e" };
  }
  if (abs >= 5) return { bg: "#45c69c", fg: "#fff" };
  if (abs >= 2) return { bg: "#96e3c8", fg: "#06684a" };
  return { bg: "#d3f4e9", fg: "#06684a" };
}

export const RESULT_TONE: Record<
  Exclude<ComparisonResult, "no_orders">,
  { bg: string; fg: string }
> = {
  match: { bg: "#e6f7ee", fg: "#0b7a41" },
  am_higher: { bg: "#e7ecfc", fg: "#2c44b8" },
  mggo_higher: { bg: "#e3f8f1", fg: "#087f5b" },
  not_using_app: { bg: "#fde8d8", fg: "#b4460a" },
  mggo_only: { bg: "#cff3e6", fg: "#06684a" },
};

export function ymdParts(ymd: string): { year: number; month: number; day: number } {
  const [year, month, day] = ymd.split("-").map(Number);
  return { year: year ?? 0, month: month ?? 1, day: day ?? 1 };
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function shiftYmd(ymd: string, days: number): string {
  const { year, month, day } = ymdParts(ymd);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthRange(year: number, month: number): { from: string; to: string } {
  return {
    from: `${year}-${pad2(month)}-01`,
    to: `${year}-${pad2(month)}-${pad2(lastDayOfMonth(year, month))}`,
  };
}

export function monthContaining(ymd: string): { year: number; month: number; from: string; to: string } {
  const { year, month } = ymdParts(ymd);
  return { year, month, ...monthRange(year, month) };
}

export function daysInRange(from: string, to: string): string[] {
  if (!from || !to || to < from) return [];
  const days: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    days.push(cursor);
    cursor = shiftYmd(cursor, 1);
  }
  return days;
}

export function weekdayShort(ymd: string): string {
  const { year, month, day } = ymdParts(ymd);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? "";
}

export function monthLabelEn(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1] ?? "January"} ${year}`;
}

export function fileMonthStamp(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1] ?? "January"}-${year}`;
}

export type ComparisonPeriodPreset = "thisMonth" | "lastMonth" | "custom";

export function comparisonPeriod(
  preset: ComparisonPeriodPreset,
  today: string,
  custom?: { from: string; to: string },
): { from: string; to: string } {
  const { year, month } = ymdParts(today);
  if (preset === "thisMonth") {
    return { from: `${year}-${pad2(month)}-01`, to: today };
  }
  if (preset === "lastMonth") {
    const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
    return monthRange(prev.year, prev.month);
  }
  const from = custom?.from ?? today;
  const to = custom?.to ?? today;
  return to < from ? { from: to, to: from } : { from, to };
}

export function spanDays(from: string, to: string): number {
  return daysInRange(from, to).length;
}

export function parseComparisonSnapshot(raw: unknown, from: string, to: string): ComparisonSnapshot {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const asDays = (value: unknown): ComparisonDayCount[] => {
    if (!Array.isArray(value)) return [];
    return value
      .map((row) => {
        const r = row as Record<string, unknown>;
        return {
          mg_id: displayMgId(r.mg_id as string | number),
          work_date: String(r.work_date ?? "").slice(0, 10),
          orders: Number(r.orders) || 0,
          rider_name: r.rider_name == null ? "" : String(r.rider_name),
        };
      })
      .filter((row) => row.mg_id && row.work_date);
  };
  const riders = Array.isArray(obj.riders)
    ? obj.riders.map((row) => {
        const r = row as Record<string, unknown>;
        return {
          mg_id: displayMgId(r.mg_id as string | number),
          driver_id: r.driver_id == null ? null : String(r.driver_id),
          rider_name: r.rider_name == null ? "" : String(r.rider_name),
          restaurant_name:
            r.restaurant_name == null || r.restaurant_name === "" ? "—" : String(r.restaurant_name),
        };
      })
    : [];
  return { from, to, am: asDays(obj.am), mggo: asDays(obj.mggo), riders };
}

function emptyDays(n: number): number[] {
  return Array.from({ length: n }, () => 0);
}

export function buildComparisonRiders(snapshot: ComparisonSnapshot, days: string[]): ComparisonRider[] {
  const dayIndex = new Map(days.map((ymd, i) => [ymd, i]));
  type Acc = {
    mgId: string;
    name: string;
    restaurant: string;
    amDays: number[];
    mggoDays: number[];
  };
  const byKey = new Map<string, Acc>();

  const take = (rawId: string, name?: string | null): Acc => {
    const key = normalizeMgId(rawId);
    let acc = byKey.get(key);
    if (!acc) {
      acc = {
        mgId: displayMgId(rawId),
        name: "",
        restaurant: "—",
        amDays: emptyDays(days.length),
        mggoDays: emptyDays(days.length),
      };
      byKey.set(key, acc);
    }
    if (name && !acc.name) acc.name = name;
    return acc;
  };

  for (const row of snapshot.am) {
    const acc = take(row.mg_id, row.rider_name);
    const i = dayIndex.get(row.work_date);
    if (i != null) acc.amDays[i] = (acc.amDays[i] ?? 0) + (Number(row.orders) || 0);
  }
  for (const row of snapshot.mggo) {
    const acc = take(row.mg_id);
    const i = dayIndex.get(row.work_date);
    if (i != null) acc.mggoDays[i] = (acc.mggoDays[i] ?? 0) + (Number(row.orders) || 0);
  }
  for (const meta of snapshot.riders) {
    const key = normalizeMgId(meta.mg_id);
    const acc = byKey.get(key);
    if (!acc) continue;
    if (meta.rider_name) acc.name = meta.rider_name;
    acc.restaurant = meta.restaurant_name?.trim() ? meta.restaurant_name : "—";
  }

  const riders: ComparisonRider[] = [];
  for (const acc of byKey.values()) {
    const am = acc.amDays.reduce((s, n) => s + n, 0);
    const mggo = acc.mggoDays.reduce((s, n) => s + n, 0);
    if (am === 0 && mggo === 0) continue;
    const diffDays = acc.amDays.map((v, i) => v - (acc.mggoDays[i] ?? 0));
    const offDays = diffDays.reduce((c, d) => c + (d !== 0 ? 1 : 0), 0);
    const workedSource = am > 0 ? acc.amDays : acc.mggoDays;
    const workedDays = workedSource.filter((v) => v > 0).length;
    const diff = am - mggo;
    riders.push({
      mgId: acc.mgId,
      name: acc.name,
      restaurant: acc.restaurant || "—",
      am,
      mggo,
      amDays: acc.amDays,
      mggoDays: acc.mggoDays,
      diffDays,
      diff,
      diffPct: am === 0 ? null : diff / am,
      offDays,
      workedDays,
      result: comparisonResult(am, mggo),
    });
  }

  return riders.sort((a, b) => {
    const byAbs = Math.abs(b.diff) - Math.abs(a.diff);
    if (byAbs !== 0) return byAbs;
    return a.mgId.localeCompare(b.mgId, undefined, { numeric: true });
  });
}

export function comparisonKpis(riders: ComparisonRider[]): ComparisonKpis {
  const active = riders.filter((r) => r.result !== "no_orders");
  const am = active.reduce((s, r) => s + r.am, 0);
  const mggo = active.reduce((s, r) => s + r.mggo, 0);
  const matches = active.filter((r) => r.result === "match").length;
  const cards = COMPARISON_RESULTS.map((result) => {
    const rows = active.filter((r) => r.result === result);
    return {
      result,
      count: rows.length,
      share: active.length === 0 ? 0 : rows.length / active.length,
      am: rows.reduce((s, r) => s + r.am, 0),
      mggo: rows.reduce((s, r) => s + r.mggo, 0),
    };
  });
  return {
    riders: active.length,
    am,
    mggo,
    net: am - mggo,
    matches,
    matchRate: active.length === 0 ? 0 : matches / active.length,
    cards,
  };
}

export function dailyTotals(riders: ComparisonRider[], days: string[]): ComparisonDailyPoint[] {
  return days.map((date, i) => {
    const am = riders.reduce((s, r) => s + (r.amDays[i] ?? 0), 0);
    const mggo = riders.reduce((s, r) => s + (r.mggoDays[i] ?? 0), 0);
    const ridersOff = riders.filter((r) => (r.diffDays[i] ?? 0) !== 0).length;
    return { date, day: ymdParts(date).day, am, mggo, diff: am - mggo, ridersOff };
  });
}

export function ridersInBoth(riders: ComparisonRider[]): ComparisonRider[] {
  return riders.filter((r) => r.am > 0 && r.mggo > 0);
}

export function ridersNotUsingApp(riders: ComparisonRider[]): ComparisonRider[] {
  return riders
    .filter((r) => r.result === "not_using_app")
    .slice()
    .sort((a, b) => b.am - a.am || a.mgId.localeCompare(b.mgId, undefined, { numeric: true }));
}

export function ridersMggoOnly(riders: ComparisonRider[]): ComparisonRider[] {
  return riders.filter((r) => r.result === "mggo_only");
}

export function ridersWithDayDiff(riders: ComparisonRider[], dayIndex: number): ComparisonRider[] {
  return riders.filter((r) => (r.diffDays[dayIndex] ?? 0) !== 0);
}

export function formatPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function avgPerDay(am: number, workedDays: number): number {
  if (workedDays <= 0) return 0;
  return am / workedDays;
}

export function colLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

export function lastDayCol(dayCount: number): string {
  return colLetter(2 + dayCount);
}
