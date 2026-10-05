import {
  EMPLOYEE_PLACEHOLDER_KEYS,
  type EsignEmployeeSnapshot,
} from "./render/esign-placeholders";

/**
 * The employee block — the fixed head of every e-signature document.
 *
 * Both the rendered PDF (`esign-document-html.ts`) and the builder's live
 * preview read this one catalogue. That is the whole point of the module: the
 * preview exists to show an author what the rider will receive, and it cannot do
 * that if it keeps its own copy of which rows the block contains or what they
 * are called. Before this file the renderer held its own label map and the
 * preview held its own sample values, so the two could drift one label at a time
 * without either side looking wrong on its own.
 *
 * Order comes from `EMPLOYEE_PLACEHOLDER_KEYS`, which is also the reserved-token
 * list, so the block prints in the same order the tokens are documented in and a
 * key can never be added in one place and forgotten in the other.
 */

export type EsignEmployeeRowKey = keyof EsignEmployeeSnapshot;

export type EsignEmployeeRow = {
  key: EsignEmployeeRowKey;
  label_en: string;
  label_ar: string;
  /**
   * Preview sample. A system row resolves from the rider's record at send time,
   * and no rider exists while a template is being drafted — showing an empty
   * cell there would read as a broken field rather than as a value that arrives
   * later. The preview marks these rows with their source badge so the sample is
   * never mistaken for stored data.
   */
  sample: string;
};

/**
 * `Record<keyof EsignEmployeeSnapshot, …>` on purpose: adding a key to the
 * snapshot without giving it a label and a sample becomes a compile error, which
 * is the only reliable way to stop a half-added row from shipping.
 *
 * `employee_id` and `driver_code` keep the panel's own wording ("Employee ID",
 * "Driver ID") rather than the mock's "Employee Code". These labels are printed
 * on documents that have already been signed and archived, and the rest of the
 * panel — Drivers, payroll, imports — names the same two columns the same way.
 * Rewording a legal artefact to match a mock is a content decision, not a
 * styling one, so it is deliberately left alone.
 */
const META: Record<EsignEmployeeRowKey, Omit<EsignEmployeeRow, "key">> = {
  company_name: {
    label_en: "Company",
    label_ar: "الشركة",
    sample: "Musallam Delivery",
  },
  employee_name: {
    label_en: "Employee name",
    label_ar: "اسم الموظف",
    sample: "Abdullah Al-Mutairi",
  },
  employee_id: {
    label_en: "Employee ID",
    label_ar: "رقم الموظف",
    sample: "10042",
  },
  driver_code: {
    label_en: "Driver ID",
    label_ar: "رقم السائق",
    sample: "10042",
  },
  civil_id: {
    label_en: "Civil ID",
    label_ar: "الرقم المدني",
    sample: "284091200123",
  },
  joined_at: {
    label_en: "Joining date",
    label_ar: "تاريخ الانضمام",
    sample: "2024-03-12",
  },
  accommodation: {
    label_en: "Accommodation",
    label_ar: "السكن",
    sample: "Hawally camp, block 4",
  },
  zone: {
    label_en: "Zone",
    label_ar: "المنطقة",
    sample: "Hawally",
  },
  project: {
    label_en: "Project",
    label_ar: "المشروع",
    sample: "Talabat",
  },
  nationality: {
    label_en: "Nationality",
    label_ar: "الجنسية",
    sample: "Kuwait",
  },
};

export const ESIGN_EMPLOYEE_ROWS: readonly EsignEmployeeRow[] =
  EMPLOYEE_PLACEHOLDER_KEYS.map((key) => ({ key, ...META[key] }));

/**
 * The rows a document always opens with, whatever the rider has on file: the
 * company, the rider and their identifying code. Everything after these is
 * printed only when it carries a value.
 */
export const ESIGN_EMPLOYEE_CORE_ROWS = ESIGN_EMPLOYEE_ROWS.slice(0, 3);

export function employeeRowLabel(
  row: Pick<EsignEmployeeRow, "label_en" | "label_ar">,
  locale: "en" | "ar",
): string {
  return locale === "ar" ? row.label_ar || row.label_en : row.label_en;
}

/** Sample values keyed the way the renderer consumes them, for the preview. */
export function employeeSampleValues(): Record<string, string> {
  return Object.fromEntries(ESIGN_EMPLOYEE_ROWS.map((row) => [row.key, row.sample]));
}

export function isEmployeeRowKey(key: string): key is EsignEmployeeRowKey {
  return ESIGN_EMPLOYEE_ROWS.some((row) => row.key === key);
}
