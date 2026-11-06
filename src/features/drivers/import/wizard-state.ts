import {
  DRIVER_IMPORT_REQUIRED_FIELDS,
  type DriverImportTargetField,
} from "../types";

/**
 * The import wizard's decisions, kept out of the dialog.
 *
 * The dialog already carried the whole import engine behind one screen; adding
 * seven steps inline would have buried which fields are required for which mode
 * among the JSX. Everything an operator can get wrong about *ordering* lives
 * here instead, where `node --test` can reach it.
 */
export type ImportWizardMode = "add" | "update";

export type ImportWizardStep =
  | "mode"
  | "fields"
  | "template"
  | "upload"
  | "map"
  | "dryRun"
  | "apply";

export const IMPORT_WIZARD_STEPS: readonly ImportWizardStep[] = [
  "mode",
  "fields",
  "template",
  "upload",
  "map",
  "dryRun",
  "apply",
];

/** Message key suffix under `pages.drivers.import.wizard`. */
export const WIZARD_STEP_LABELS: Record<ImportWizardStep, string> = {
  mode: "stepMode",
  fields: "stepFields",
  template: "stepTemplate",
  upload: "stepUpload",
  map: "stepMap",
  dryRun: "stepDryRun",
  apply: "stepApply",
};

/**
 * `add` refuses a row whose MG ID already exists, `update` writes into the person
 * it matches. This is the strategy the preview and the job have always taken —
 * the mode only names it up front instead of hiding it behind a switch.
 */
export function modeToStrategy(mode: ImportWizardMode): "skip" | "update" {
  return mode === "add" ? "skip" : "update";
}

export function strategyToMode(strategy: "skip" | "update"): ImportWizardMode {
  return strategy === "update" ? "update" : "add";
}

/**
 * Fields the sheet must map, per mode.
 *
 * A new employee needs the five identity facts. An update is matched on MG ID
 * alone: the operator selects nationality, maps nationality, and the blank
 * remainder must not be reported as a missing mapping.
 */
export function requiredTargetFields(
  mode: ImportWizardMode,
): readonly DriverImportTargetField[] {
  if (mode === "update") return ["employee_id"];
  return DRIVER_IMPORT_REQUIRED_FIELDS;
}

/** MG ID identifies the person on an update, so it can never be dropped. */
export function pinnedTargetFields(
  mode: ImportWizardMode,
): readonly DriverImportTargetField[] {
  if (mode === "update") return ["employee_id"];
  return DRIVER_IMPORT_REQUIRED_FIELDS;
}

export type ImportFieldGroup =
  | "identity"
  | "assignment"
  | "employment"
  | "bank"
  | "documents"
  | "flags"
  | "custom";

export const IMPORT_FIELD_GROUPS: readonly ImportFieldGroup[] = [
  "identity",
  "assignment",
  "employment",
  "bank",
  "documents",
  "flags",
  "custom",
];


const GROUP_BY_FIELD: Partial<Record<DriverImportTargetField, ImportFieldGroup>> = {
  full_name: "identity",
  employee_id: "identity",
  client_id: "identity",
  client_name: "identity",
  phone: "identity",
  civil_id: "identity",
  passport_number: "identity",
  nationality: "identity",
  nationality_category_keys: "identity",
  rider_category: "identity",
  source_company: "identity",
  project_key: "identity",
  accommodation: "identity",

  zone_id: "assignment",
  restaurant_ids: "assignment",
  partner_id: "assignment",
  vehicle_label: "assignment",
  vehicle_type: "assignment",
  off_days: "assignment",
  asset_ids: "assignment",

  employee_status_key: "employment",
  section_keys: "employment",
  work_start_date: "employment",
  sponsorship_key: "employment",
  job_position: "employment",
  hiring_type: "employment",
  job_end_date: "employment",
  job_end_description: "employment",
  residency_expiry_date: "employment",
  fixed_salary: "employment",
  work_permit_salary: "employment",
  last_increment_date: "employment",
  currency: "employment",

  bank_code: "bank",
  account_number: "bank",
  iban: "bank",
  beneficiary_civil_id: "bank",

  license_expiry: "documents",
  civil_id_expiry: "documents",
  work_permit_expiry: "documents",
  passport_expiry: "documents",
  health_card_expiry: "documents",
  operations_card_expiry: "documents",

  active: "flags",
  screenshots_allowed: "flags",
  login_verification_exempt: "flags",
};

export function fieldGroup(field: DriverImportTargetField): ImportFieldGroup {
  if (field.startsWith("cf:")) return "custom";
  return GROUP_BY_FIELD[field] ?? "identity";
}

/**
 * Default selection. Add keeps today's behaviour — every column in the sheet —
 * because a create sheet that silently dropped a column would be a regression.
 * Update starts at MG ID alone, so picking the field to change is the point of
 * the step rather than an afterthought.
 */
export function defaultSelectedFields(
  mode: ImportWizardMode,
  fields: readonly DriverImportTargetField[],
): DriverImportTargetField[] {
  if (mode === "update") {
    return fields.includes("employee_id") ? ["employee_id"] : fields.slice(0, 1);
  }
  return [...fields];
}

/** Order the selection follows: the catalogue's order, never click order. */
export function orderSelectedFields(
  selected: readonly string[],
  fields: readonly DriverImportTargetField[],
): DriverImportTargetField[] {
  const wanted = new Set(selected);
  return fields.filter((field) => wanted.has(field));
}

export function toggleSelectedField(
  selected: readonly string[],
  field: DriverImportTargetField,
  pinned: readonly string[],
): DriverImportTargetField[] {
  if (pinned.includes(field)) return selected as DriverImportTargetField[];
  return selected.includes(field)
    ? (selected.filter((value) => value !== field) as DriverImportTargetField[])
    : ([...selected, field] as DriverImportTargetField[]);
}

export function stepIndex(step: ImportWizardStep): number {
  const index = IMPORT_WIZARD_STEPS.indexOf(step);
  return index === -1 ? 0 : index;
}

export function nextWizardStep(step: ImportWizardStep): ImportWizardStep | null {
  return IMPORT_WIZARD_STEPS[stepIndex(step) + 1] ?? null;
}

export function previousWizardStep(step: ImportWizardStep): ImportWizardStep | null {
  const index = stepIndex(step) - 1;
  return index < 0 ? null : (IMPORT_WIZARD_STEPS[index] ?? null);
}

export type WizardGuardState = {
  mode: ImportWizardMode;
  selectedFieldCount: number;
  headers: readonly string[];
  mapping: Partial<Record<DriverImportTargetField, string>>;
  duplicateHeaderCount: number;
  readyCount: number;
};

/** Required fields with no column pointing at them. */
export function missingMappedFields(
  mode: ImportWizardMode,
  mapping: Partial<Record<DriverImportTargetField, string>>,
): DriverImportTargetField[] {
  return requiredTargetFields(mode).filter((field) => !mapping[field]);
}

/**
 * Whether *Continue* moves off this step.
 *
 * `template` is deliberately unguarded — downloading the workbook is optional,
 * because an operator who already has the file should not be forced to generate
 * it again. `apply` is terminal, so it never has a next step to allow.
 */
export function canLeaveStep(
  step: ImportWizardStep,
  state: WizardGuardState,
): boolean {
  switch (step) {
    case "mode":
      return state.mode === "add" || state.mode === "update";
    case "fields":
      return state.selectedFieldCount > 0;
    case "template":
      return true;
    case "upload":
      return state.headers.length > 0;
    case "map":
      return (
        state.duplicateHeaderCount === 0 &&
        missingMappedFields(state.mode, state.mapping).length === 0
      );
    case "dryRun":
      return state.readyCount > 0;
    case "apply":
      return false;
    default: {
      const exhaustive: never = step;
      return Boolean(exhaustive);
    }
  }
}
