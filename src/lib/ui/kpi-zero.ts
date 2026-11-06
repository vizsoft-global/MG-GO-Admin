/**
 * A metric of zero on an interactive card is an empty widget, not a filter target that
 * pretends there is something behind it. Percentages ("0.0%") and loaders ("…") are
 * measurements, not empty lists, so they keep the normal card shell.
 */
export function isZeroMetricValue(value: string | number): boolean {
  if (typeof value === "number") return value === 0;
  return /^0(?:\.0+)?$/.test(value.trim());
}
