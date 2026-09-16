import {
  decideImportRowMatch,
  namesMatch,
  type ImportLookupMatch,
  type ImportRowDecision,
} from "@/features/drivers/resolve-import-row";

export type GroupImportInputRow = {
  employee_id?: string;
  driver_code?: string;
  name?: string;
};

export type GroupImportIdentityStatus = ImportRowDecision["status"] | "mismatch";

const EMP_HEADER = /employee[\s_-]*id/i;
const CODE_HEADER = /driver[\s_-]*(code|id)|mg[\s_-]*id|rider[\s_-]*(code|id)/i;
const NAME_HEADER = /driver[\s_-]*name|full[\s_-]*name|^name$/i;

export function mapGroupImportRows(
  headers: string[],
  rows: string[][],
): GroupImportInputRow[] {
  const empIdx = headers.findIndex((h) => EMP_HEADER.test(h.trim()));
  const codeIdx = headers.findIndex((h) => CODE_HEADER.test(h.trim()));
  const nameIdx = headers.findIndex((h) => NAME_HEADER.test(h.trim()));
  return rows.map((cells) => ({
    employee_id: empIdx >= 0 ? (cells[empIdx] ?? "") : (cells[0] ?? ""),
    driver_code: codeIdx >= 0 ? (cells[codeIdx] ?? "") : "",
    name: nameIdx >= 0 ? (cells[nameIdx] ?? "") : "",
  }));
}

export function decideGroupImportRow(input: {
  employeeId?: string | null;
  driverCode?: string | null;
  name?: string | null;
  byEmployee: ImportLookupMatch | null;
  byCode: ImportLookupMatch | null;
}): { status: GroupImportIdentityStatus; driver: ImportLookupMatch | null } {
  const decided = decideImportRowMatch({
    employeeId: input.employeeId,
    driverCode: input.driverCode,
    byEmployee: input.byEmployee,
    byCode: input.byCode,
  });
  if (decided.status !== "ok" || !decided.driver) return decided;
  const uploaded = input.name?.trim() ?? "";
  if (!uploaded) return decided;
  if (!namesMatch(uploaded, decided.driver.full_name)) {
    return { status: "mismatch", driver: decided.driver };
  }
  return decided;
}

export function groupImportDisplayName(
  status: GroupImportIdentityStatus | "already_in_group" | "duplicate",
  uploadedName: string,
  resolvedName: string | null,
): string | null {
  if (status === "ok" || status === "already_in_group" || status === "duplicate") {
    return resolvedName;
  }
  return uploadedName.trim() || null;
}
