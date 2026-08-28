const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** List-scan reads are not a request action — they dump the list date preset into Details. */
export function isRequestsListScan(routeName: string | null | undefined): boolean {
  return routeName === "requests.list";
}

export type RequestsAuditDetail =
  | { kind: "error"; message: string }
  | { kind: "opened"; code: string | null; type: string | null }
  | { kind: "created"; code: string | null; type: string | null }
  | {
      kind: "decided";
      code: string | null;
      type: string | null;
      action: string;
      status: string | null;
    }
  | { kind: "terms"; code: string | null; fields: string[] }
  | { kind: "fuel"; code: string | null; transferType: string | null }
  | { kind: "text"; text: string };

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function stringOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

/**
 * Human-readable DETAILS for the RCM audit table.
 * Never echo the All-Requests date preset (`this_month`) — that is how the
 * filter and the column used to disagree.
 */
export function describeRequestsAudit(input: {
  routeName: string | null;
  context: unknown;
  changedFields: unknown;
  errorMessage: string | null;
  targetCode: string | null;
  targetType: string | null;
}): RequestsAuditDetail {
  if (input.errorMessage) return { kind: "error", message: input.errorMessage };

  const context = asRecord(input.context);
  const code = input.targetCode;
  const type = input.targetType;

  switch (input.routeName) {
    case "requests.detail":
      return { kind: "opened", code, type };
    case "requests.createOnBehalf":
      return { kind: "created", code, type: type ?? stringOrNull(context.requestType) };
    case "requests.decide":
    case "requests.decide_bulk":
      return {
        kind: "decided",
        code,
        type,
        action: stringOrNull(context.decideAction) ?? "update",
        status: stringOrNull(context.status),
      };
    case "requests.decisionTerms":
      return { kind: "terms", code, fields: stringList(context.terms) };
    case "requests.fuelTransferType":
      return { kind: "fuel", code, transferType: stringOrNull(context.transferType) };
    default:
      break;
  }

  const fields = Array.isArray(input.changedFields)
    ? input.changedFields.map(String).filter(Boolean)
    : [];
  if (fields.length > 0) return { kind: "text", text: fields.join(", ") };

  const parts = Object.entries(context)
    .filter(([key, value]) => {
      if (value == null || typeof value === "object") return false;
      if (key === "preset" || key === "datePreset") return false;
      return !UUID_RE.test(String(value));
    })
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`);
  return { kind: "text", text: parts.join(" · ") };
}

export function auditDetailSearchText(detail: RequestsAuditDetail): string {
  switch (detail.kind) {
    case "error":
      return detail.message;
    case "opened":
    case "created":
      return [detail.code, detail.type].filter(Boolean).join(" ");
    case "decided":
      return [detail.code, detail.type, detail.action, detail.status].filter(Boolean).join(" ");
    case "terms":
      return [detail.code, ...detail.fields].join(" ");
    case "fuel":
      return [detail.code, detail.transferType].filter(Boolean).join(" ");
    case "text":
      return detail.text;
  }
}
