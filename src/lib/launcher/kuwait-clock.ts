const ZONE = "Asia/Kuwait";

export function ordinalDay(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

export function kuwaitClock(date: Date, locale: string) {
  const loc = locale === "ar" ? "ar" : "en-US";
  const weekday = new Intl.DateTimeFormat(loc, {
    timeZone: ZONE,
    weekday: "short",
  }).format(date);
  const day = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: ZONE, day: "numeric" }).format(date),
  );
  const month = new Intl.DateTimeFormat(loc, {
    timeZone: ZONE,
    month: "long",
  }).format(date);
  const time = new Intl.DateTimeFormat(loc, {
    timeZone: ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return {
    weekday,
    dayLabel: locale === "ar" ? String(day) : ordinalDay(day),
    month,
    time,
  };
}
