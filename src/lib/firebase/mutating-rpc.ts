const WRITE_VERBS = new Set([
  "save",
  "delete",
  "update",
  "set",
  "add",
  "reset",
  "upsert",
  "create",
  "remove",
  "revoke",
  "approve",
  "reject",
  "assign",
  "import",
  "purge",
  "bulk",
  "open",
  "expire",
  "archive",
  "claim",
  "sync",
  "ingest",
  "record",
  "compose",
  "dispatch",
  "send",
  "mark",
  "clear",
  "apply",
  "grant",
  "deny",
  "withdraw",
  "close",
  "cancel",
  "verify",
  "adjust",
  "publish",
  "activate",
  "deactivate",
  "checkout",
  "checkin",
  "decide",
  "decline",
  "escalate",
  "forward",
  "insert",
  "link",
  "resend",
  "remind",
  "reschedule",
  "submit",
  "upload",
  "generate",
  "recalculate",
  "reconcile",
  "void",
  "correct",
  "restore",
  "regenerate",
  "force",
  "recompute",
  "enqueue",
]);

const READ_VERBS = new Set([
  "list",
  "get",
  "fetch",
  "count",
  "search",
  "snapshot",
  "filter",
  "preview",
  "read",
  "export",
  "report",
]);

function rpcTokens(rpcName: string): string[] {
  return rpcName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

function hasVerb(tokens: string[], verbs: Set<string>): boolean {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (verbs.has(token)) return true;
    if (token === "check") {
      const next = tokens[index + 1];
      if ((next === "in" || next === "out") && verbs.has(token + next)) return true;
    }
  }
  return false;
}

/** Staff RPC names that mutate. Reads win when a name contains both kinds of verb. */
export function isMutatingAdminRpc(rpcName: string): boolean {
  const tokens = rpcTokens(rpcName);
  if (hasVerb(tokens, READ_VERBS)) return false;
  return hasVerb(tokens, WRITE_VERBS);
}
