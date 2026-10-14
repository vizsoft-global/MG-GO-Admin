import {
  ESIGN_STAFF_SIGNER_ROLES,
  type EsignCounterSignatureState,
  type EsignStaffSignerRole,
} from "./types";

export function isEsignStaffSignerRole(value: string): value is EsignStaffSignerRole {
  return (ESIGN_STAFF_SIGNER_ROLES as readonly string[]).includes(value);
}

/**
 * The employee status stays the employee's. Counter-signature is a second
 * fact: only a signed request with a still-pending staff row is waiting.
 */
export function isAwaitingCounterSignature(input: {
  requestStatus: string;
  hasPendingStaffSigner: boolean;
}): boolean {
  return input.requestStatus === "signed" && input.hasPendingStaffSigner;
}

export function counterSignatureState(staffStatuses: string[]): EsignCounterSignatureState {
  if (staffStatuses.length === 0) return "none";
  if (staffStatuses.some((status) => status === "declined")) return "declined";
  if (staffStatuses.some((status) => status === "pending")) return "pending";
  return "signed";
}

export function previewStaffLabel(
  rows: readonly { display_name: string }[],
  selectedName: string,
  fallback: string,
): string {
  const fromRows = rows.map((row) => row.display_name.trim()).find(Boolean);
  const picked = selectedName.trim();
  return fromRows || picked || fallback;
}
