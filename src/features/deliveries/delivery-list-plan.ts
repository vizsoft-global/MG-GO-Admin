import { prefixBounds } from "@/lib/search/prefix";

/** Firestore `in` queries reject more than 30 values. */
export const GPS_IN_CHUNK = 30;

/**
 * Existing deliveries search cap. A prefix match set stops here. It is not
 * the whole collection, and it is not a created_at cursor.
 */
export const DELIVERY_SEARCH_CAP = 20_000;

/** Prefix range queries need at least this many trimmed characters. */
export const DELIVERY_PREFIX_MIN_LENGTH = 4;

/**
 * Prefix search is safe only after every delivery stores `order_id_lower`.
 * One stamped row is not enough: the probe would turn prefix on and an
 * unstamped order would come back as an empty page. Stays false until a
 * backfill `--apply` is approved and checked.
 */
export const DELIVERY_SEARCH_BACKFILL_COMPLETE = false;

/** True only when the field exists on the collection and the backfill is done. */
export function deliverySearchUsesPrefix(probeFoundField: boolean, backfillComplete: boolean): boolean {
  return backfillComplete && probeFoundField;
}

/**
 * An empty prefix page is not "no results" while deliveries can still lack
 * `order_id_lower`. A capped page is left alone: falling through would scan
 * a set the prefix query already said is larger than the cap.
 */
export function prefixPageNeedsFullScan(input: {
  backfillComplete: boolean;
  rowCount: number;
  capped: boolean;
}): boolean {
  if (input.backfillComplete) return false;
  if (input.capped) return false;
  return input.rowCount === 0;
}

export function prefixPageDecision(input: {
  backfillComplete: boolean;
  probeFoundField: boolean;
  prefixRowCount: number | null;
  capped: boolean;
}): "prefix" | "scan" {
  if (!deliverySearchUsesPrefix(input.probeFoundField, input.backfillComplete)) return "scan";
  if (input.prefixRowCount === null) return "scan";
  if (
    prefixPageNeedsFullScan({
      backfillComplete: input.backfillComplete,
      rowCount: input.prefixRowCount,
      capped: input.capped,
    })
  ) {
    return "scan";
  }
  return "prefix";
}

/**
 * Prefix queries page in prefix-field order. Firestore applies the range
 * field as the first orderBy, so an index of (order_id_lower, created_at desc)
 * does not return newest-first. The deliveries list loads at most
 * DELIVERY_SEARCH_CAP matches in prefix-field order, sorts that set in memory
 * by created_at desc, then slices the page.
 *
 * Stored lowercase fields a prefix can use. There is no `driver_search`
 * column — `search_name` is the identity string.
 */
export const DELIVERY_LIST_PREFIX_FIELDS = [
  "order_id_lower",
  "rider_name_lower",
  "driver_name_lower",
  "driver_code_lower",
  "employee_id_lower",
  "search_name",
] as const;

export type DeliveryPrefixField = (typeof DELIVERY_LIST_PREFIX_FIELDS)[number];

/**
 * Which UI fields are a prefix and which are contains.
 *
 * prefix: start of an order id (`order_id_lower`), start of a name
 * (`rider_name_lower`, `driver_name_lower`, `driver_code_lower`,
 * `employee_id_lower`, `search_name`).
 * contains: last digits of an order id (`external_order_id`), a rider's last
 * name (`profiles.full_name`). The deliveries search box is contains.
 * Do not send a contains term to a prefix query.
 */
export const DELIVERY_SEARCH_FIELDS = {
  prefix: {
    orderIdStart: "order_id_lower",
    nameStart: [
      "rider_name_lower",
      "driver_name_lower",
      "driver_code_lower",
      "employee_id_lower",
      "search_name",
    ],
  },
  contains: {
    orderIdLastDigits: "external_order_id",
    riderLastName: "profiles.full_name",
  },
} as const;

export type DeliverySearchShape = "prefix" | "contains";

export type PrefixMatchRow = {
  id: string;
  createdAtMs: number;
};

function byCreatedAtDesc(left: PrefixMatchRow, right: PrefixMatchRow): number {
  if (right.createdAtMs !== left.createdAtMs) return right.createdAtMs - left.createdAtMs;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

/**
 * Contains searches stay on the scan. The deliveries search box is contains,
 * so one term checks both of these.
 *
 * Last digits (`external_order_id`) and a rider last name (`profiles.full_name`)
 * are not prefix matches. The scan reads every `drivers` doc (`driver_code`)
 * and every `profiles` doc (`full_name`), keeps at most 300 matching ids, then
 * reads deliveries in `created_at` desc until the page fills or
 * DELIVERY_SEARCH_CAP delivery docs have been read. Past that cap the page can
 * be short and later matches are omitted (`searchTruncated`). There is no
 * production collection count in this repo, so the driver and profile reads
 * are the full collections, and delivery reads are at most 20_000.
 */
export const CONTAINS_SCAN_READS = {
  orderIdLastDigits: "external_order_id",
  riderLastName: "profiles.full_name",
  driverDocs: "all",
  profileDocs: "all",
  matchedDriverIdCap: 300,
  deliveryDocsMax: DELIVERY_SEARCH_CAP,
} as const;

/**
 * Hard cap on the prefix match set.
 *
 * Each field query already stops at DELIVERY_SEARCH_CAP in prefix-field order,
 * not created_at order. `fieldSaturated` means at least one of those queries
 * returned the cap, so matches that sort later in the prefix field were not
 * fetched. A newer delivery can be in that omitted tail.
 *
 * When the fetched union is larger than the cap, this keeps the newest
 * `cap` rows of what was fetched and drops the rest. Those dropped rows are
 * the oldest of the fetched window only. They are not a proof that older
 * documents are the only ones missing.
 *
 * `truncated` is true in either case. The caller must not treat `rows.length`
 * as the true match count, and must not fall through to a collection scan.
 */
export function capPrefixMatchSet(
  matches: readonly PrefixMatchRow[],
  cap: number,
  fieldSaturated: boolean,
): { rows: PrefixMatchRow[]; truncated: boolean } {
  const sorted = [...matches].sort(byCreatedAtDesc);
  const over = sorted.length > cap;
  return {
    rows: over ? sorted.slice(0, cap) : sorted,
    truncated: fieldSaturated || over,
  };
}

/**
 * Newest-first page of a prefix match set. The order is applied in memory.
 * It is not the Firestore cursor.
 */
export function pagePrefixMatches(
  matches: readonly PrefixMatchRow[],
  offset: number,
  limit: number,
): PrefixMatchRow[] {
  return [...matches].sort(byCreatedAtDesc).slice(offset, offset + limit);
}

export type DeliveryListRoute =
  | { kind: "indexed"; reasons: string[] }
  | {
      kind: "prefix";
      fieldEquality: "status" | "zone_id" | "partner_id" | null;
      bounds: { start: string; end: string };
      reasons: string[];
    }
  | { kind: "prefix_too_short"; reasons: string[] }
  | { kind: "scan"; reasons: string[] };

export type DeliveryListRouteInput = {
  search?: string;
  /** Default `contains`: the list search box. Prefix is opt-in. */
  searchShape?: DeliverySearchShape;
  cancelReason?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  zoneId?: string;
  partnerId?: string;
  indexed: boolean;
  offset: number;
  limit: number;
};

function setAndNotAll(value: string | undefined): boolean {
  return Boolean(value && value !== "all");
}

/**
 * Pick the deliveries list access path.
 *
 * A contains term (last digits, last name) stays on the scan at any length.
 * A prefix shorter than DELIVERY_PREFIX_MIN_LENGTH is `prefix_too_short`:
 * no range query and no scan, so the empty page is not a finished search.
 * A longer prefix pages in prefix-field order up to DELIVERY_SEARCH_CAP;
 * the caller sorts that set by created_at.
 */
export function routeDeliveryList(input: DeliveryListRouteInput): DeliveryListRoute {
  const search = (input.search ?? "").trim();
  const shape: DeliverySearchShape = input.searchShape ?? "contains";
  const reasons: string[] = [];
  if (input.cancelReason && input.cancelReason !== "all") reasons.push("cancel_reason");
  if (search && /^[0-9a-f]{1,8}$/.test(search.toLowerCase())) reasons.push("document_id_prefix");
  if (search && (input.dateFrom || input.dateTo)) reasons.push("search_plus_delivered_at_range");
  const status = setAndNotAll(input.status);
  const zone = setAndNotAll(input.zoneId);
  const partner = setAndNotAll(input.partnerId);
  if (search && zone && partner) reasons.push("search_plus_zone_and_partner");
  const equalities = [status, zone, partner].filter(Boolean).length;
  if (search && equalities > 1) reasons.push("search_plus_multiple_equalities");
  if (!search) {
    if (reasons.length === 0) return { kind: "indexed", reasons: [] };
    return { kind: "scan", reasons };
  }
  switch (shape) {
    case "contains":
      reasons.push("contains_search");
      return { kind: "scan", reasons };
    case "prefix":
      if (search.length < DELIVERY_PREFIX_MIN_LENGTH) {
        return { kind: "prefix_too_short", reasons: ["prefix_too_short"] };
      }
      break;
    default: {
      const unexpected: never = shape;
      return unexpected;
    }
  }
  if (!input.indexed) reasons.push("lowercase_field_absent");
  if (reasons.length > 0) return { kind: "scan", reasons };
  const bounds = prefixBounds(search);
  if (!bounds) return { kind: "scan", reasons: ["empty_prefix"] };
  const fieldEquality = status ? "status" : zone ? "zone_id" : partner ? "partner_id" : null;
  return { kind: "prefix", fieldEquality, bounds, reasons: [] };
}

export function chunkIds(ids: readonly string[], size: number): string[][] {
  if (size < 1) throw new Error("chunk_size");
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}

export function gpsInChunks(ids: readonly string[]): string[][] {
  return chunkIds(ids, GPS_IN_CHUNK);
}
