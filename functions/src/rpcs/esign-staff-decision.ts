/**
 * Staff management decision on an eSign request.
 *
 * Signature and approval are separate: a countersignature with no decision
 * is only "signed". Decline (refuse to sign) is not this Rejected decision.
 */

export type EsignStaffDecision = "approved" | "rejected";

export type EsignSignerNotifyKind = "signed" | "approved" | "rejected";

export function parseEsignStaffDecision(raw: unknown): EsignStaffDecision | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (value === "approved" || value === "approve") return "approved";
  if (value === "rejected" || value === "reject") return "rejected";
  return null;
}

export function managementDecisionLabel(decision: EsignStaffDecision): string {
  switch (decision) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    default: {
      const _never: never = decision;
      throw new Error(`unexpected staff decision: ${String(_never)}`);
    }
  }
}

/** This submit's decision wins. A later sign-only keeps the decision already stored. */
export function signerNotifyKind(
  thisDecision: EsignStaffDecision | null,
  stored: unknown,
): EsignSignerNotifyKind {
  const decision = thisDecision ?? parseEsignStaffDecision(stored);
  switch (decision) {
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case null:
      return "signed";
    default: {
      const _never: never = decision;
      throw new Error(`unexpected staff decision: ${String(_never)}`);
    }
  }
}

export function signerNotifyCopy(
  kind: EsignSignerNotifyKind,
  documentName: string,
  reason?: string | null,
): { title: string; body: string } {
  const name = documentName.trim();
  const note = reason?.trim() ?? "";
  switch (kind) {
    case "approved":
      return {
        title: "Document approved",
        body: `${name} was approved by management`,
      };
    case "rejected":
      return {
        title: "Document rejected",
        body:
          note.length > 0
            ? `${name} was rejected by management: ${note}`
            : `${name} was rejected by management`,
      };
    case "signed":
      return {
        title: "Document signed",
        body: `${name} was signed by management`,
      };
    default: {
      const _never: never = kind;
      throw new Error(`unexpected signer notify kind: ${String(_never)}`);
    }
  }
}
