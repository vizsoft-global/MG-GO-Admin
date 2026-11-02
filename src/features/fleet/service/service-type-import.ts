import {
  categoryForServiceType,
  isServiceCategoryKey,
  normaliseServiceTypeName,
  serviceTypeKey,
  type ServiceCategoryKey,
} from "./service-types";

/** Column order of the downloadable template. The client's own sheet has one column. */
export const SERVICE_TYPE_IMPORT_HEADERS = [
  "Service type",
  "Arabic",
  "Category",
  "Active",
] as const;

export const SERVICE_TYPE_IMPORT_CAP = 1000;

export type ServiceTypeImportStatus = "create" | "update" | "duplicate" | "error";

export type ServiceTypeImportItem = {
  /** 1-based row number in the uploaded sheet, so a duplicate can be found. */
  sheetRow: number;
  name: string;
  labelEn: string;
  labelAr: string;
  category: ServiceCategoryKey;
  key: string;
  active: boolean;
  status: ServiceTypeImportStatus;
  /** `duplicate_of_row` carries the first row that claimed the name. */
  message: string;
};

export type ServiceTypeImportPreview = {
  items: ServiceTypeImportItem[];
  counts: Record<ServiceTypeImportStatus, number> & { total: number };
  categoryCounts: Record<string, number>;
  truncated: boolean;
};

type ExistingType = {
  key: string;
  label_en: string;
  label_ar: string | null;
  category: string | null;
  is_active: boolean;
};

function cell(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function truthy(value: string): boolean {
  const text = value.trim().toLowerCase();
  if (!text) return true;
  return !["no", "false", "0", "inactive", "off"].includes(text);
}

type HeaderMap = {
  headerRow: number;
  name: number;
  arabic: number;
  category: number;
  active: number;
};

function findHeader(rows: readonly (readonly unknown[])[]): HeaderMap {
  for (let i = 0; i < Math.min(rows.length, 5); i += 1) {
    const row = rows[i] ?? [];
    const cells = row.map((value) => cell(value).toLowerCase());
    const nameIndex = cells.findIndex((value) =>
      /^(service\s*type|service|type|name|النوع|نوع الخدمة)$/.test(value),
    );
    if (nameIndex >= 0) {
      return {
        headerRow: i,
        name: nameIndex,
        arabic: cells.findIndex((value) => /^(arabic|العربية|الاسم العربي)$/.test(value)),
        category: cells.findIndex((value) => /^(category|الفئة)$/.test(value)),
        active: cells.findIndex((value) => /^(active|مفعل)$/.test(value)),
      };
    }
  }
  // No header: the first column is the name, exactly like the client's sheet.
  return { headerRow: -1, name: 0, arabic: -1, category: -1, active: -1 };
}

/**
 * Preview an uploaded sheet against the catalog. Every skipped row is reported —
 * the duplicate "Full service" is listed with its sheet row number rather than
 * being dropped on the floor.
 */
export function previewServiceTypeImport(
  rows: readonly (readonly unknown[])[],
  existing: readonly ExistingType[],
): ServiceTypeImportPreview {
  const header = findHeader(rows);
  const byKey = new Map(existing.map((row) => [row.key, row]));
  const seen = new Map<string, number>();
  const items: ServiceTypeImportItem[] = [];
  const categoryCounts: Record<string, number> = {};
  let truncated = false;

  for (let i = header.headerRow + 1; i < rows.length; i += 1) {
    if (items.length >= SERVICE_TYPE_IMPORT_CAP) {
      truncated = true;
      break;
    }
    const row = rows[i] ?? [];
    const rawName = cell(row[header.name]);
    const arabic = header.arabic >= 0 ? cell(row[header.arabic]) : "";
    const rawCategory = header.category >= 0 ? cell(row[header.category]).toLowerCase() : "";
    const active = header.active >= 0 ? truthy(cell(row[header.active])) : true;
    const sheetRow = i + 1;

    if (!rawName) continue;

    const labelEn = rawName.replace(/\s+/g, " ").trim();
    const normalised = normaliseServiceTypeName(labelEn);
    const key = serviceTypeKey(labelEn);

    const firstClaim = seen.get(normalised) ?? seen.get(key);
    if (firstClaim != null) {
      items.push({
        sheetRow,
        name: labelEn,
        labelEn,
        labelAr: arabic,
        category: isServiceCategoryKey(rawCategory)
          ? rawCategory
          : categoryForServiceType(labelEn),
        key,
        active,
        status: "duplicate",
        message: `duplicate_of_row:${firstClaim}`,
      });
      continue;
    }
    seen.set(normalised, sheetRow);
    seen.set(key, sheetRow);

    if (!labelEn) {
      items.push({
        sheetRow,
        name: "",
        labelEn: "",
        labelAr: arabic,
        category: "other",
        key,
        active,
        status: "error",
        message: "missing_name",
      });
      continue;
    }

    const category: ServiceCategoryKey = isServiceCategoryKey(rawCategory)
      ? rawCategory
      : categoryForServiceType(labelEn);
    categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;

    const match = byKey.get(key);
    items.push({
      sheetRow,
      name: labelEn,
      labelEn,
      labelAr: arabic,
      category,
      key,
      active,
      status: match ? "update" : "create",
      message: match ? "existing_key" : "",
    });
  }

  const counts = {
    create: items.filter((item) => item.status === "create").length,
    update: items.filter((item) => item.status === "update").length,
    duplicate: items.filter((item) => item.status === "duplicate").length,
    error: items.filter((item) => item.status === "error").length,
    total: items.length,
  };

  return { items, counts, categoryCounts, truncated };
}

/** Only rows that would actually write are sent to the server. */
export function writableImportRows(preview: ServiceTypeImportPreview) {
  return preview.items.filter((item) => item.status === "create" || item.status === "update");
}

export function serviceTypeTemplateRows(): string[][] {
  return [
    [...SERVICE_TYPE_IMPORT_HEADERS],
    ["Full service", "صيانة كاملة", "engine", "yes"],
    ["Brake pads", "فحمات الفرامل", "brakes", "yes"],
  ];
}
