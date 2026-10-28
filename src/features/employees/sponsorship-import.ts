import {
  CATALOG_KEY_RE,
  catalogKeyFromLabel,
  DEFAULT_SPONSORSHIPS,
  isSystemSponsorshipKey,
} from "./employee-catalogs";

export const SPONSORSHIP_IMPORT_CAP = 200;

export const SPONSORSHIP_IMPORT_COLUMNS = [
  { header: "Key", required: false, allowed: "lowercase letters, numbers, underscore. Blank uses English.", example: "in_house" },
  { header: "English", required: true, allowed: "Required on a new row. Blank on an update keeps the stored label. `-` is refused.", example: "In-house" },
  { header: "Arabic", required: false, allowed: "Blank on an update keeps the stored label. `-` copies English.", example: "داخلي" },
  { header: "Active", required: false, allowed: "yes or no. Blank on a new row is yes; an update keeps the stored flag. `-` is no. System rows cannot be no.", example: "yes" },
  { header: "Sort", required: false, allowed: "Integer. Blank on a new row is 0; an update keeps the stored order. `-` is 0.", example: "10" },
] as const;

export type SponsorshipImportExisting = {
  key: string;
  label_en: string;
  label_ar: string;
  is_active: boolean;
  is_system: boolean;
  sort_order: number;
};

export type SponsorshipImportPayload = {
  key: string;
  label_en: string;
  label_ar: string;
  is_active: boolean;
  is_system: boolean;
  sort_order: number;
};

export type SponsorshipImportFileError = "empty" | "too_many" | "missing_columns";

export type SponsorshipImportRowError =
  | "duplicate_key"
  | "invalid_key"
  | "missing_fields"
  | "system_status_locked"
  | "invalid_active"
  | "invalid_sort";

export type SponsorshipImportStatus = "create" | "update" | "error";

export type SponsorshipImportPreviewRow = {
  rowIndex: number;
  status: SponsorshipImportStatus;
  error: SponsorshipImportRowError | null;
  key: string;
  label_en: string;
  label_ar: string;
  is_active: boolean;
  sort_order: number;
  payload: SponsorshipImportPayload | null;
};

export type SponsorshipImportPreview = {
  error: SponsorshipImportFileError | null;
  rows: SponsorshipImportPreviewRow[];
};

type SponsorshipImportField = "key" | "english" | "arabic" | "active" | "sort";

const FIELD_ALIASES: Record<SponsorshipImportField, readonly string[]> = {
  key: ["key"],
  english: ["english", "label en", "label_en", "en", "label"],
  arabic: ["arabic", "label ar", "label_ar", "ar"],
  active: ["active", "is active", "is_active"],
  sort: ["sort", "sort order", "sort_order"],
};

const FIELD_ORDER: readonly SponsorshipImportField[] = ["key", "english", "arabic", "active", "sort"];

function isClearCell(raw: string): boolean {
  return raw === "-";
}

function normHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sponsorshipImportFieldForHeader(header: string): SponsorshipImportField | null {
  const n = normHeader(header);
  if (!n) return null;
  for (const field of FIELD_ORDER) {
    for (const alias of FIELD_ALIASES[field]) {
      if (n === alias || n.startsWith(`${alias} `)) return field;
    }
  }
  return null;
}

function mapHeaders(headers: string[]): Partial<Record<SponsorshipImportField, number>> {
  const map: Partial<Record<SponsorshipImportField, number>> = {};
  headers.forEach((header, index) => {
    const field = sponsorshipImportFieldForHeader(header);
    if (!field || map[field] !== undefined) return;
    map[field] = index;
  });
  return map;
}

function cellAt(
  row: string[],
  columns: Partial<Record<SponsorshipImportField, number>>,
  field: SponsorshipImportField,
): string {
  const index = columns[field];
  if (index === undefined) return "";
  return (row[index] ?? "").trim();
}

function parseActiveCell(
  raw: string,
): { kind: "keep" } | { kind: "set"; value: boolean } | { kind: "error" } {
  if (!raw) return { kind: "keep" };
  if (isClearCell(raw)) return { kind: "set", value: false };
  const n = raw.toLowerCase();
  if (n === "yes" || n === "y" || n === "true" || n === "1" || n === "on") {
    return { kind: "set", value: true };
  }
  if (n === "no" || n === "n" || n === "false" || n === "0" || n === "off") {
    return { kind: "set", value: false };
  }
  return { kind: "error" };
}

function parseSortCell(
  raw: string,
): { kind: "keep" } | { kind: "set"; value: number } | { kind: "error" } {
  if (!raw) return { kind: "keep" };
  if (isClearCell(raw)) return { kind: "set", value: 0 };
  if (!/^-?\d+$/.test(raw)) return { kind: "error" };
  return { kind: "set", value: Number(raw) };
}

function rowIsBlank(
  row: string[],
  columns: Partial<Record<SponsorshipImportField, number>>,
): boolean {
  return FIELD_ORDER.every((field) => !cellAt(row, columns, field));
}

function fail(
  rowIndex: number,
  error: SponsorshipImportRowError,
  draft: {
    key: string;
    label_en: string;
    label_ar: string;
    is_active: boolean;
    sort_order: number;
  },
): SponsorshipImportPreviewRow {
  return {
    rowIndex,
    status: "error",
    error,
    key: draft.key,
    label_en: draft.label_en,
    label_ar: draft.label_ar,
    is_active: draft.is_active,
    sort_order: draft.sort_order,
    payload: null,
  };
}

export function previewSponsorshipImport(input: {
  headers: string[];
  rows: string[][];
  existing: readonly SponsorshipImportExisting[];
}): SponsorshipImportPreview {
  const columns = mapHeaders(input.headers);
  if (columns.english === undefined && columns.key === undefined) {
    return { error: "missing_columns", rows: [] };
  }

  const data: Array<{ sheetRow: number; cells: string[] }> = [];
  input.rows.forEach((cells, index) => {
    if (rowIsBlank(cells, columns)) return;
    data.push({ sheetRow: index + 2, cells });
  });

  if (data.length === 0) return { error: "empty", rows: [] };
  if (data.length > SPONSORSHIP_IMPORT_CAP) return { error: "too_many", rows: [] };

  const byKey = new Map(input.existing.map((row) => [row.key, row]));
  const seen = new Map<string, number[]>();
  const parsed: SponsorshipImportPreviewRow[] = [];

  for (const item of data) {
    const keyRaw = cellAt(item.cells, columns, "key");
    const englishRaw = cellAt(item.cells, columns, "english");
    const arabicRaw = cellAt(item.cells, columns, "arabic");
    const activeRaw = cellAt(item.cells, columns, "active");
    const sortRaw = cellAt(item.cells, columns, "sort");

    let key = keyRaw.toLowerCase();
    if (!key && !isClearCell(keyRaw)) {
      key = catalogKeyFromLabel(englishRaw);
    }

    const existing = key ? byKey.get(key) : undefined;
    const isUpdate = Boolean(existing);

    const english =
      !englishRaw ? (existing?.label_en ?? "") : isClearCell(englishRaw) ? "" : englishRaw;
    const arabic =
      !arabicRaw
        ? (existing?.label_ar ?? "")
        : isClearCell(arabicRaw)
          ? english
          : arabicRaw;

    const activeParsed = parseActiveCell(activeRaw);
    const sortParsed = parseSortCell(sortRaw);

    const isActive =
      activeParsed.kind === "set" ? activeParsed.value : existing?.is_active ?? true;
    const sortOrder =
      sortParsed.kind === "set" ? sortParsed.value : existing?.sort_order ?? 0;

    const draft = {
      key,
      label_en: english,
      label_ar: arabic,
      is_active: isActive,
      sort_order: sortOrder,
    };

    if (isClearCell(keyRaw) || !CATALOG_KEY_RE.test(key)) {
      parsed.push(fail(item.sheetRow, "invalid_key", draft));
      continue;
    }
    if (!english) {
      parsed.push(fail(item.sheetRow, "missing_fields", draft));
      continue;
    }
    if (activeParsed.kind === "error") {
      parsed.push(fail(item.sheetRow, "invalid_active", draft));
      continue;
    }
    if (sortParsed.kind === "error") {
      parsed.push(fail(item.sheetRow, "invalid_sort", draft));
      continue;
    }
    if ((existing?.is_system || isSystemSponsorshipKey(key)) && !isActive) {
      parsed.push(fail(item.sheetRow, "system_status_locked", draft));
      continue;
    }

    const hits = seen.get(key) ?? [];
    hits.push(parsed.length);
    seen.set(key, hits);

    const payload: SponsorshipImportPayload = {
      key,
      label_en: english,
      label_ar: arabic || english,
      is_active: isActive,
      is_system: existing?.is_system ?? isSystemSponsorshipKey(key),
      sort_order: sortOrder,
    };

    parsed.push({
      rowIndex: item.sheetRow,
      status: isUpdate ? "update" : "create",
      error: null,
      key,
      label_en: english,
      label_ar: payload.label_ar,
      is_active: isActive,
      sort_order: sortOrder,
      payload,
    });
  }

  for (const indexes of seen.values()) {
    if (indexes.length < 2) continue;
    for (const index of indexes) {
      const row = parsed[index];
      if (!row) continue;
      parsed[index] = fail(row.rowIndex, "duplicate_key", row);
    }
  }

  return { error: null, rows: parsed };
}

export function sponsorshipImportTemplateSheets(): Array<{
  name: string;
  aoa: Array<Array<string | number>>;
}> {
  const headers = SPONSORSHIP_IMPORT_COLUMNS.map((column) => column.header);
  const sample = DEFAULT_SPONSORSHIPS.map((row) => [
    row.key,
    row.label_en,
    row.label_ar,
    row.is_active ? "yes" : "no",
    row.sort_order,
  ]);
  const guide = [
    ["Column", "Required", "Notes", "Example"],
    ...SPONSORSHIP_IMPORT_COLUMNS.map((column) => [
      column.header,
      column.required ? "yes" : "no",
      column.allowed,
      column.example,
    ]),
    ["", "", "Logo is not in this sheet. Edit a row to upload a logo.", ""],
    ["", "", "A blank cell on an existing key keeps the stored value. `-` clears Arabic or Active/Sort as documented.", ""],
  ];
  return [
    { name: "Sponsorships", aoa: [headers, ...sample] },
    { name: "Guide", aoa: guide },
  ];
}
