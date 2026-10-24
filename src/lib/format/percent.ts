/** A 0–100 percentage rounded to one decimal for display interpolations. */
export function roundPercent(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Number(value.toFixed(1));
}

/** Display a 0–100 percentage at one decimal place. */
export function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

/** Display a 0–1 ratio as a 0–100 percentage at one decimal place. */
export function formatUnitPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatPct(value * 100);
}
