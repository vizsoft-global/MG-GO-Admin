import {
  employeeIdKey,
  isValidEmployeeId,
  normalizeEmployeeId,
} from "../driver-errors";
import { normalizeCivilId, normalizeKuwaitPhone } from "../driver-phone";
import type { DriverImportPreviewStatus } from "../types";

export type ImportIdentityRoster = {
  employeeIds: Set<string>;
  phoneToEmployee: Map<string, string>;
  civilToEmployee: Map<string, string>;
};

export type ImportIdentitySeen = {
  employeeIds: Set<string>;
  phones: Map<string, string>;
  civils: Map<string, string>;
};

export type ImportIdentityResult = {
  status: DriverImportPreviewStatus;
  existingByEmployeeId: boolean;
  employeeId: string | null;
  phone: string | null;
  civilId: string | null;
};

export function evaluateImportIdentity(
  row: {
    full_name: string | null;
    employee_id: string | null;
    phone: string | null;
    civil_id: string | null;
  },
  roster: ImportIdentityRoster,
  seen: ImportIdentitySeen,
): ImportIdentityResult {
  const name = row.full_name?.trim() ?? "";
  const phone = row.phone?.trim() ? normalizeKuwaitPhone(row.phone) : null;
  const civilId = row.civil_id?.trim() ? normalizeCivilId(row.civil_id) : null;
  const employeeId = row.employee_id ? normalizeEmployeeId(row.employee_id) : null;

  if (!name || !row.employee_id?.trim()) {
    return {
      status: "missing_fields",
      existingByEmployeeId: false,
      employeeId,
      phone,
      civilId,
    };
  }
  if (row.phone?.trim() && !phone) {
    return {
      status: "invalid_phone",
      existingByEmployeeId: false,
      employeeId,
      phone,
      civilId,
    };
  }
  if (row.civil_id?.trim() && !civilId) {
    return {
      status: "invalid_civil_id",
      existingByEmployeeId: false,
      employeeId,
      phone,
      civilId,
    };
  }
  if (!employeeId || !isValidEmployeeId(employeeId)) {
    return {
      status: "invalid_employee_id",
      existingByEmployeeId: false,
      employeeId,
      phone,
      civilId,
    };
  }

  const empKey = employeeIdKey(employeeId);
  const sheetDup = seen.employeeIds.has(empKey);
  seen.employeeIds.add(empKey);

  if (sheetDup) {
    return {
      status: "duplicate_employee_id",
      existingByEmployeeId: false,
      employeeId,
      phone,
      civilId,
    };
  }

  if (phone) {
    const owner = roster.phoneToEmployee.get(phone) ?? seen.phones.get(phone);
    if (owner && owner !== empKey) {
      return {
        status: "duplicate_phone",
        existingByEmployeeId: roster.employeeIds.has(empKey),
        employeeId,
        phone,
        civilId,
      };
    }
    seen.phones.set(phone, empKey);
  }

  if (civilId) {
    const owner = roster.civilToEmployee.get(civilId) ?? seen.civils.get(civilId);
    if (owner && owner !== empKey) {
      return {
        status: "duplicate_civil_id",
        existingByEmployeeId: roster.employeeIds.has(empKey),
        employeeId,
        phone,
        civilId,
      };
    }
    seen.civils.set(civilId, empKey);
  }

  const existingByEmployeeId = roster.employeeIds.has(empKey);
  return {
    status: existingByEmployeeId ? "duplicate_employee_id" : "ok",
    existingByEmployeeId,
    employeeId,
    phone,
    civilId,
  };
}

export function canContinueImportLookups(result: ImportIdentityResult): boolean {
  return result.status === "ok" || result.existingByEmployeeId;
}

export function isImportRowReady(
  row: { status: DriverImportPreviewStatus; existingByEmployeeId?: boolean; skip?: boolean },
  strategy: "skip" | "update",
): boolean {
  if (row.skip) return false;
  if (row.status === "ok") return true;
  return (
    strategy === "update" &&
    row.status === "duplicate_employee_id" &&
    row.existingByEmployeeId === true
  );
}

/** Approve mints a login. An intake that is already linked already has one. */
export function shouldApproveImportRow(
  approveRequested: boolean,
  alreadyLinked: boolean,
): boolean {
  return approveRequested && !alreadyLinked;
}
