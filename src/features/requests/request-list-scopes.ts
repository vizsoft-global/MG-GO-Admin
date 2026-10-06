export type RequestListScope =
  | "assigned"
  | "forwarded"
  | "action"
  | "due"
  | "handled"
  | "all"
  | null;

export function listScopeFlags(scope: RequestListScope): {
  assignedToMe: boolean;
  forwardedToMe: boolean;
  handledByMe: boolean;
  dueToday: boolean;
} {
  return {
    assignedToMe: scope === "assigned" || scope === "action",
    forwardedToMe: scope === "forwarded",
    handledByMe: scope === "handled",
    dueToday: scope === "due",
  };
}

export function parseRequestListScope(value: string | undefined | null): RequestListScope {
  if (
    value === "assigned" ||
    value === "forwarded" ||
    value === "action" ||
    value === "due" ||
    value === "handled" ||
    value === "all"
  ) {
    return value;
  }
  return null;
}
