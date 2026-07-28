const KUWAIT_TZ = "Asia/Kuwait";

function formatKuwaitYmd(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KUWAIT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function parseYmd(ymd: string): Date {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function shiftKuwaitYmd(ymd: string, deltaDays: number): string {
  const shifted = parseYmd(ymd);
  shifted.setUTCDate(shifted.getUTCDate() + deltaDays);
  return formatKuwaitYmd(shifted);
}

export function kuwaitTodayYmd(): string {
  return formatKuwaitYmd(new Date());
}

/** Default earnings range start — N days before today in Asia/Kuwait. */
export function defaultStartDate(daysBack = 7): string {
  return shiftKuwaitYmd(kuwaitTodayYmd(), -daysBack);
}

/** Default range end — today in Asia/Kuwait. */
export function defaultEndDate(): string {
  return kuwaitTodayYmd();
}

/** Payout list filter — one calendar month back in Asia/Kuwait. */
export function defaultStartDateMonthsAgo(months = 1): string {
  const today = kuwaitTodayYmd();
  const [year, month] = today.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 - months, 1));
  return formatKuwaitYmd(d);
}

/** First day of the current month in Asia/Kuwait. */
export function defaultFirstOfMonthYmd(): string {
  const today = kuwaitTodayYmd();
  return `${today.slice(0, 7)}-01`;
}
