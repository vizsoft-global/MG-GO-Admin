const PLATE_RE = /^[0-9]{1,3}\/[0-9]{1,6}$/;

export function isKuwaitPlate(value: string | null | undefined): boolean {
  return Boolean(value && PLATE_RE.test(value.trim()));
}

export function normalizePlate(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

/** `5/6767` → `5-6767` so bike_id stays unique and app-safe. */
export function plateToBikeId(plate: string): string {
  return plate.trim().replace(/\//g, "-").slice(0, 32);
}
