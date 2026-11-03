const EN_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const AR_WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"] as const;
const AR_MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
] as const;

/**
 * `Tuesday, 03 Nov 2026` without `Intl.DateTimeFormat`. Node and Chrome disagree
 * on the comma in `en-GB`, which made the subtitle hydrate from server text to
 * different client text. The frame prints one fixed shape, so the string is
 * assembled here and both sides always agree.
 */
export function v2WeekdayDate(ymd: string, locale: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const date = new Date(`${ymd}T00:00:00Z`);
  const arabic = locale === "ar";
  const weekday = (arabic ? AR_WEEKDAYS : EN_WEEKDAYS)[date.getUTCDay()] ?? "";
  const month = (arabic ? AR_MONTHS : EN_MONTHS)[date.getUTCMonth()] ?? "";
  const day = String(date.getUTCDate()).padStart(2, "0");
  return arabic
    ? `${weekday}، ${day} ${month} ${date.getUTCFullYear()}`
    : `${weekday}, ${day} ${month} ${date.getUTCFullYear()}`;
}

/** `03 Nov` / `03 نوفمبر`, the shape the Date filter prints. */
export function v2DayMonth(ymd: string, locale: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const date = new Date(`${ymd}T00:00:00Z`);
  const month = (locale === "ar" ? AR_MONTHS : EN_MONTHS)[date.getUTCMonth()] ?? "";
  return `${String(date.getUTCDate()).padStart(2, "0")} ${month}`;
}
