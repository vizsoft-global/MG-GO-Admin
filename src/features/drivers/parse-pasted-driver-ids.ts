/**
 * Parse pasted employee / driver lookup IDs from free text.
 * Accepts commas, whitespace, Arabic separators, Excel `.0` / scientific forms.
 * Values are 1–8 digit strings (employee_id format; driver_code is 5 digits).
 */
export function parsePastedDriverLookupIds(raw: string): string[] {
  if (!raw.trim()) return [];

  // Expand Excel-style scientific notation before tokenizing (e.g. 1.0000035e7 → 10000035).
  const expanded = raw.replace(/(\d+(?:\.\d+)?)[eE]([+-]?\d+)/g, (full, base, exp) => {
    const n = Number(`${base}e${exp}`);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return full;
    const asInt = String(n);
    return asInt.length >= 1 && asInt.length <= 8 ? asInt : full;
  });

  const tokens = expanded
    .split(/[\n\r,;|/\t\s\u060C\u061B_-]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const ids: string[] = [];
  for (const token of tokens) {
    const cleaned = token
      .replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E]/g, "")
      .replace(/^['"`]+|['"`]+$/g, "")
      .trim();
    if (!cleaned) continue;

    if (/^\d+\.0+$/.test(cleaned)) {
      const whole = cleaned.slice(0, cleaned.indexOf("."));
      if (/^\d{1,8}$/.test(whole)) {
        ids.push(whole);
        continue;
      }
    }

    if (/^\d{1,8}$/.test(cleaned)) {
      ids.push(cleaned);
      continue;
    }

    // "ID:12345" / "Emp 12345" — only when every digit in the token forms one 1–8 id.
    const digits = cleaned.replace(/\D/g, "");
    if (/^\d{1,8}$/.test(digits)) {
      ids.push(digits);
    }
  }

  return [...new Set(ids)];
}

export function normalizeDriverLookupIds(ids: string[]): string[] {
  return parsePastedDriverLookupIds(ids.join("\n"));
}
