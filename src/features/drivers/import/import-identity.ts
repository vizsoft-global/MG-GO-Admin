import { normalizeClientValue } from "../driver-client-fields";
import {
  employeeIdKey,
  isValidEmployeeId,
  normalizeEmployeeId,
} from "../driver-errors";
import { normalizeCivilId, normalizeKuwaitPhone } from "../driver-phone";
import type { DriverImportPreviewStatus } from "../types";

export function clientIdKey(raw: string | null | undefined): string | null {
  const value = normalizeClientValue(raw);
  return value ? value.toLowerCase() : null;
}

export type ImportIdentityRoster = {
  employeeIds: Set<string>;
  phoneToEmployee: Map<string, string>;
  civilToEmployee: Map<string, string>;
  clientIdToEmployees: Map<string, Set<string>>;
  employeeIdByKey: Map<string, string>;
};

export type ImportIdentitySeen = {
  employeeIds: Set<string>;
  phones: Map<string, string>;
  civils: Map<string, string>;
  clientIds: Map<string, string>;
};

export type ImportIdentityResult = {
  status: DriverImportPreviewStatus;
  existingByEmployeeId: boolean;
  existingByClientId: boolean;
  employeeId: string | null;
  resolvedEmployeeId: string | null;
  phone: string | null;
  civilId: string | null;
};

function result(
  status: DriverImportPreviewStatus,
  fields: Omit<ImportIdentityResult, "status">,
): ImportIdentityResult {
  return { status, ...fields };
}

export function evaluateImportIdentity(
  row: {
    full_name: string | null;
    employee_id: string | null;
    phone: string | null;
    civil_id: string | null;
    client_id?: string | null;
  },
  roster: ImportIdentityRoster,
  seen: ImportIdentitySeen,
): ImportIdentityResult {
  const name = row.full_name?.trim() ?? "";
  const phone = row.phone?.trim() ? normalizeKuwaitPhone(row.phone) : null;
  const civilId = row.civil_id?.trim() ? normalizeCivilId(row.civil_id) : null;
  const employeeId = row.employee_id ? normalizeEmployeeId(row.employee_id) : null;
  const clientKey = clientIdKey(row.client_id);

  const blank = {
    existingByEmployeeId: false,
    existingByClientId: false,
    employeeId,
    resolvedEmployeeId: employeeId,
    phone,
    civilId,
  };

  if (row.phone?.trim() && !phone) {
    return result("invalid_phone", blank);
  }
  if (row.civil_id?.trim() && !civilId) {
    return result("invalid_civil_id", blank);
  }
  if (row.employee_id?.trim() && (!employeeId || !isValidEmployeeId(employeeId))) {
    return result("invalid_employee_id", blank);
  }

  const empKey = employeeId && isValidEmployeeId(employeeId) ? employeeIdKey(employeeId) : null;
  const clientOwners = clientKey ? roster.clientIdToEmployees.get(clientKey) : undefined;
  const uniqueClientOwner =
    clientOwners?.size === 1 ? [...clientOwners][0] ?? null : null;
  const ambiguousClient = Boolean(clientKey && clientOwners && clientOwners.size > 1);

  if (empKey && clientOwners && clientOwners.size > 0 && !clientOwners.has(empKey)) {
    return result("client_id_mismatch", {
      ...blank,
      existingByEmployeeId: roster.employeeIds.has(empKey),
    });
  }

  if (!empKey && ambiguousClient) {
    return result("ambiguous_client_id", blank);
  }

  if (!empKey && uniqueClientOwner) {
    const resolved = roster.employeeIdByKey.get(uniqueClientOwner) ?? null;
    const sheetOwner = clientKey ? seen.clientIds.get(clientKey) : undefined;
    if (clientKey && sheetOwner) {
      return result("duplicate_client_id", {
        existingByEmployeeId: false,
        existingByClientId: false,
        employeeId: resolved,
        resolvedEmployeeId: resolved,
        phone,
        civilId,
      });
    }
    if (seen.employeeIds.has(uniqueClientOwner)) {
      return result("duplicate_client_id", {
        existingByEmployeeId: false,
        existingByClientId: false,
        employeeId: resolved,
        resolvedEmployeeId: resolved,
        phone,
        civilId,
      });
    }
    if (clientKey) seen.clientIds.set(clientKey, uniqueClientOwner);
    seen.employeeIds.add(uniqueClientOwner);
    const clash = clashPhoneOrCivil(uniqueClientOwner, phone, civilId, roster, seen);
    if (clash) {
      return result(clash, {
        existingByEmployeeId: true,
        existingByClientId: true,
        employeeId: resolved,
        resolvedEmployeeId: resolved,
        phone,
        civilId,
      });
    }
    return result("duplicate_client_id", {
      existingByEmployeeId: true,
      existingByClientId: true,
      employeeId: resolved,
      resolvedEmployeeId: resolved,
      phone,
      civilId,
    });
  }

  if (!empKey) {
    return result("missing_fields", blank);
  }

  if (!name && !roster.employeeIds.has(empKey)) {
    return result("missing_fields", blank);
  }

  const sheetDup = seen.employeeIds.has(empKey);
  seen.employeeIds.add(empKey);
  if (clientKey && !seen.clientIds.has(clientKey)) {
    seen.clientIds.set(clientKey, empKey);
  }

  if (sheetDup) {
    return result("duplicate_employee_id", {
      ...blank,
      existingByEmployeeId: false,
      resolvedEmployeeId: employeeId,
    });
  }

  const clash = clashPhoneOrCivil(empKey, phone, civilId, roster, seen);
  if (clash) {
    return result(clash, {
      ...blank,
      existingByEmployeeId: roster.employeeIds.has(empKey),
      existingByClientId: uniqueClientOwner === empKey,
      resolvedEmployeeId: employeeId,
    });
  }

  const existingByEmployeeId = roster.employeeIds.has(empKey);
  return result(existingByEmployeeId ? "duplicate_employee_id" : "ok", {
    existingByEmployeeId,
    existingByClientId: uniqueClientOwner === empKey,
    employeeId,
    resolvedEmployeeId: employeeId,
    phone,
    civilId,
  });
}

function clashPhoneOrCivil(
  empKey: string,
  phone: string | null,
  civilId: string | null,
  roster: ImportIdentityRoster,
  seen: ImportIdentitySeen,
): "duplicate_phone" | "duplicate_civil_id" | null {
  if (phone) {
    const owner = roster.phoneToEmployee.get(phone) ?? seen.phones.get(phone);
    if (owner && owner !== empKey) return "duplicate_phone";
    seen.phones.set(phone, empKey);
  }
  if (civilId) {
    const owner = roster.civilToEmployee.get(civilId) ?? seen.civils.get(civilId);
    if (owner && owner !== empKey) return "duplicate_civil_id";
    seen.civils.set(civilId, empKey);
  }
  return null;
}

export function canContinueImportLookups(result: ImportIdentityResult): boolean {
  return (
    result.status === "ok" ||
    result.existingByEmployeeId ||
    result.existingByClientId
  );
}

export function isImportRowReady(
  row: {
    status: DriverImportPreviewStatus;
    existingByEmployeeId?: boolean;
    existingByClientId?: boolean;
    skip?: boolean;
  },
  strategy: "skip" | "update",
): boolean {
  if (row.skip) return false;
  if (row.status === "ok") return true;
  if (strategy !== "update") return false;
  if (row.status === "duplicate_employee_id" && row.existingByEmployeeId === true) {
    return true;
  }
  return row.status === "duplicate_client_id" && row.existingByClientId === true;
}

/** Approve mints a login. An intake that is already linked already has one. */
export function shouldApproveImportRow(
  approveRequested: boolean,
  alreadyLinked: boolean,
): boolean {
  return approveRequested && !alreadyLinked;
}
