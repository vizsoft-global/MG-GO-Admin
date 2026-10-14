export const SENT_SCOPES = ["all", "batch", "individual"] as const;

export type SentScope = (typeof SENT_SCOPES)[number];

export function parseSentScope(value: string | null | undefined): SentScope {
  switch (value) {
    case "all":
    case "batch":
    case "individual":
      return value;
    default:
      return "all";
  }
}
