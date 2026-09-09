export type ParsedSheet = {
  headers: string[];
  rows: string[][];
  headerSignature: string;
};

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;

export function cleanCell(value: unknown): string {
  if (value == null) return "";
  let s = String(value).replace(ZERO_WIDTH, "");
  s = s.replace(/\s+/g, " ").trim();
  return normalizeDigits(s);
}

function normalizeDigits(s: string): string {
  const arabicIndic = "٠١٢٣٤٥٦٧٨٩";
  const easternArabic = "۰۱۲۳۴۵۶۷۸۹";
  return s
    .split("")
    .map((ch) => {
      const a = arabicIndic.indexOf(ch);
      if (a >= 0) return String(a);
      const e = easternArabic.indexOf(ch);
      if (e >= 0) return String(e);
      return ch;
    })
    .join("");
}

/**
 * Normalise common spreadsheet date inputs to ISO `YYYY-MM-DD`.
 */
export function normalizeDateToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const serial = Number(raw);
  if (Number.isFinite(serial) && /^\d{4,6}(\.\d+)?$/.test(raw)) {
    const epoch = Date.UTC(1899, 11, 30);
    const d = new Date(epoch + Math.round(serial) * 86_400_000);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }

  const parts = raw.split(/[/\-.]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 3 && parts.every((p) => /^\d{1,4}$/.test(p))) {
    let day: number;
    let month: number;
    let year: number;
    if (parts[0]!.length === 4) {
      year = Number(parts[0]);
      month = Number(parts[1]);
      day = Number(parts[2]);
    } else {
      const a = Number(parts[0]);
      const b = Number(parts[1]);
      const c = Number(parts[2]);
      year = c < 100 ? 2000 + c : c;
      if (a > 12 && b <= 12) {
        day = a;
        month = b;
      } else if (b > 12 && a <= 12) {
        month = a;
        day = b;
      } else {
        day = a;
        month = b;
      }
    }
    if (
      Number.isFinite(day) &&
      Number.isFinite(month) &&
      Number.isFinite(year) &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const d = new Date(`${iso}T00:00:00Z`);
      if (!Number.isNaN(d.getTime())) return iso;
    }
  }

  const fallback = new Date(raw);
  if (!Number.isNaN(fallback.getTime())) {
    return fallback.toISOString().slice(0, 10);
  }

  return raw;
}

export function headerSignature(headers: string[]): string {
  return headers.map((h) => cleanCell(h).toLowerCase()).sort().join("|");
}

export function loadStoredMapping<T extends string>(
  storagePrefix: string,
  signature: string,
): Partial<Record<T, string>> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${storagePrefix}${signature}`);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<Record<T, string>>;
  } catch {
    return null;
  }
}

export function saveStoredMapping<T extends string>(
  storagePrefix: string,
  signature: string,
  mapping: Partial<Record<T, string>>,
) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      `${storagePrefix}${signature}`,
      JSON.stringify(mapping),
    );
  } catch {
    /* ignore */
  }
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function parseCsvText(text: string): ParsedSheet {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return { headers: [], rows: [], headerSignature: "" };
  }
  const parsed = lines.map(parseCsvLine);
  const headers = (parsed[0] ?? []).map((c) => cleanCell(c));
  const rows = parsed.slice(1).map((r) => r.map((c) => cleanCell(c)));
  return {
    headers,
    rows,
    headerSignature: headerSignature(headers),
  };
}

function isCsvFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".csv") ||
    file.type === "text/csv" ||
    file.type === "text/plain"
  );
}

export async function parseSpreadsheetFile(
  file: File,
  options?: { raw?: boolean },
): Promise<ParsedSheet> {
  if (isCsvFile(file)) {
    return parseCsvText(await file.text());
  }
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: false });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: null,
    raw: options?.raw ?? false,
  }) as (string | number | null)[][];

  if (matrix.length < 2) {
    return { headers: [], rows: [], headerSignature: "" };
  }

  const headers = (matrix[0] ?? []).map((c) => cleanCell(c));
  const rows = matrix.slice(1).map((r) => (r ?? []).map((c) => cleanCell(c)));
  return {
    headers,
    rows,
    headerSignature: headerSignature(headers),
  };
}
