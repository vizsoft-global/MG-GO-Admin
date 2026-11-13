/**
 * Cloudflare GraphQL Analytics reader for the usage monitor.
 *
 * Cloudflare documents the datasets but not every field on them, and the ones it
 * leaves out (Durable Object duration, WebSocket message counts, SQLite rows) are
 * exactly the ones the bill is built from. So a query here is a set of fields the
 * docs confirm plus a set that are only believed to exist: when the API rejects
 * one by name it is dropped and the query retried, and the caller is told which
 * figures it did not get. One unknown field must not blank the whole section.
 *
 * The same goes for the time filter. Adaptive datasets filter on `datetime`; the
 * periodic ones are only documented with `date`. The first form the API accepts
 * is remembered per dataset.
 */

export type CloudflareContext = { accountId: string; token: string };

export type CloudflareRow = {
  sum: Record<string, number>;
  max: Record<string, number>;
  dimensions: Record<string, string>;
};

export type CloudflareResult =
  | {
      ok: true;
      rows: CloudflareRow[];
      /** Optional fields the API refused; their figures are unknown, not zero. */
      missing: string[];
      /** "day" when only whole days could be asked for, so the window is approximate. */
      granularity: "exact" | "day";
    }
  | { ok: false; message: string };

export type CloudflarePost = (
  query: string,
  variables: Record<string, string>,
) => Promise<{ data?: unknown; errors?: Array<{ message?: string }> }>;

type FilterKind = "datetime" | "datetimeHour" | "date";

const FILTER_ORDER: readonly FilterKind[] = ["datetime", "datetimeHour", "date"];
const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const MAX_ATTEMPTS = 10;
const REQUEST_TIMEOUT_MS = 20_000;

/** What the API has already told this process, so the discovery is paid once. */
const filterMemo = new Map<string, FilterKind>();
const refusedFields = new Set<string>();

export function resetCloudflareAnalyticsMemo(): void {
  filterMemo.clear();
  refusedFields.clear();
}

export function cloudflareContext(): CloudflareContext | { error: string } {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = process.env.R2_ACCOUNT_ID?.trim() || process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!token) return { error: "missing_cloudflare_token" };
  if (!accountId) return { error: "missing_cloudflare_account" };
  return { accountId, token };
}

export function cloudflarePoster(context: CloudflareContext): CloudflarePost {
  return async (query, variables) => {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${context.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return (await response.json()) as { data?: unknown; errors?: Array<{ message?: string }> };
  };
}

function filterClause(kind: FilterKind): { clause: string; declarations: string } {
  if (kind === "date") {
    return {
      clause: "date_geq: $startDate, date_leq: $endDate",
      declarations: "$startDate: Date!, $endDate: Date!",
    };
  }
  return {
    clause: `${kind}_geq: $start, ${kind}_leq: $end`,
    declarations: "$start: Time!, $end: Time!",
  };
}

function buildQuery(args: {
  dataset: string;
  kind: FilterKind;
  sum: readonly string[];
  max: readonly string[];
  dimensions: readonly string[];
}): string {
  const filter = filterClause(args.kind);
  const selection = [
    args.sum.length > 0 ? `sum { ${args.sum.join(" ")} }` : "",
    args.max.length > 0 ? `max { ${args.max.join(" ")} }` : "",
    args.dimensions.length > 0 ? `dimensions { ${args.dimensions.join(" ")} }` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `query UsageMonitor($accountTag: string!, ${filter.declarations}) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      ${args.dataset}(limit: 10000, filter: { ${filter.clause} }) { ${selection} }
    }
  }
}`;
}

function numbers(source: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!source || typeof source !== "object") return out;
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) out[key] = parsed;
  }
  return out;
}

function strings(source: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!source || typeof source !== "object") return out;
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (value != null) out[key] = String(value);
  }
  return out;
}

function rowsOf(data: unknown, dataset: string): CloudflareRow[] | null {
  const viewer = (data as { viewer?: { accounts?: Array<Record<string, unknown>> } } | undefined)
    ?.viewer;
  const account = viewer?.accounts?.[0];
  if (!account) return null;
  const groups = account[dataset];
  if (!Array.isArray(groups)) return null;
  return groups.map((group) => {
    const entry = group as { sum?: unknown; max?: unknown; dimensions?: unknown };
    return {
      sum: numbers(entry.sum),
      max: numbers(entry.max),
      dimensions: strings(entry.dimensions),
    };
  });
}

/** A field name counts as named by an error only as a whole word. */
function names(message: string, field: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9_])${field}([^A-Za-z0-9_]|$)`).test(message);
}

export async function queryCloudflareDataset(
  post: CloudflarePost,
  accountId: string,
  args: {
    dataset: string;
    sum?: readonly string[];
    optionalSum?: readonly string[];
    max?: readonly string[];
    dimensions?: readonly string[];
    startMs: number;
    endMs: number;
  },
): Promise<CloudflareResult> {
  const required = args.sum ?? [];
  const max = args.max ?? [];
  const dimensions = args.dimensions ?? [];
  const refusedKey = (field: string) => `${args.dataset}.${field}`;

  const remembered = filterMemo.get(args.dataset);
  const kinds = remembered ? [remembered] : [...FILTER_ORDER];
  let kindIndex = 0;
  let withoutOptional = false;

  const variables = {
    accountTag: accountId,
    start: new Date(args.startMs).toISOString(),
    end: new Date(args.endMs).toISOString(),
    startDate: new Date(args.startMs).toISOString().slice(0, 10),
    endDate: new Date(args.endMs).toISOString().slice(0, 10),
  };

  let lastMessage = "analytics_failed";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const kind = kinds[kindIndex]!;
    const optional = withoutOptional
      ? []
      : (args.optionalSum ?? []).filter((field) => !refusedFields.has(refusedKey(field)));
    const sum = [...required, ...optional];
    if (sum.length === 0 && max.length === 0) {
      return { ok: false, message: "no_fields" };
    }

    // Only the variables the query declares may be sent.
    const sent: Record<string, string> =
      kind === "date"
        ? {
            accountTag: variables.accountTag,
            startDate: variables.startDate,
            endDate: variables.endDate,
          }
        : { accountTag: variables.accountTag, start: variables.start, end: variables.end };

    let body: { data?: unknown; errors?: Array<{ message?: string }> };
    try {
      body = await post(buildQuery({ dataset: args.dataset, kind, sum, max, dimensions }), sent);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "fetch_failed" };
    }

    if (!body.errors?.length) {
      const rows = rowsOf(body.data, args.dataset);
      if (!rows) return { ok: false, message: "no_account_data" };
      filterMemo.set(args.dataset, kind);
      const missing = (args.optionalSum ?? []).filter((field) => !optional.includes(field));
      return { ok: true, rows, missing, granularity: kind === "date" ? "day" : "exact" };
    }

    const message = body.errors.map((entry) => entry.message ?? "").join(" | ");
    lastMessage = message || lastMessage;

    const refused = optional.filter((field) => names(message, field));
    if (refused.length > 0) {
      for (const field of refused) refusedFields.add(refusedKey(field));
      continue;
    }
    if ((names(message, `${kind}_geq`) || names(message, `${kind}_leq`)) && kindIndex < kinds.length - 1) {
      kindIndex += 1;
      continue;
    }
    // An error that names nothing we can drop: try once with the documented
    // fields alone before moving to the next filter form or giving up.
    if (optional.length > 0) {
      withoutOptional = true;
      continue;
    }
    if (kindIndex < kinds.length - 1) {
      kindIndex += 1;
      withoutOptional = false;
      continue;
    }
    break;
  }

  return { ok: false, message: lastMessage };
}
