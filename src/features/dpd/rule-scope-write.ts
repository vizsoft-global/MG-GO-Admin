import type { RuleScopeType } from "./types";

/** One `delivery_rule_scopes` / `incentive_rule_scopes` row. */
export type RuleScopeWriteRow = {
  zone_id: string | null;
  partner_id: string | null;
  restaurant_id: string | null;
};

export type RuleScopeWrite = {
  /** The first selected id, written to the legacy single-FK column. */
  legacyId: string | null;
  /** `zone_id` / `partner_id` / `restaurant_id` for the rule's own document. */
  legacyColumns: RuleScopeWriteRow;
  /** One junction row per selected id. */
  rows: RuleScopeWriteRow[];
};

/**
 * The one shape a rule save writes its scope in.
 *
 * Firestore carried two places for one fact while `*_rule_scopes` was being
 * introduced, so a save has to write **both**: the legacy single-FK column (the
 * first selected id, which older documents and the functions' canonical matcher
 * read) and one junction row per selected id. Reading the junction alone dropped
 * every legacy row; writing the legacy column alone dropped every extra id. Both
 * functions that save a rule call this, so the two paths cannot drift.
 */
export function ruleScopeWrite(
  scopeType: RuleScopeType,
  ids: readonly string[],
): RuleScopeWrite {
  const unique = [
    ...new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0)),
  ];
  const legacyId = unique[0] ?? null;
  return {
    legacyId,
    legacyColumns: {
      zone_id: scopeType === "zone" ? legacyId : null,
      partner_id: scopeType === "partner" ? legacyId : null,
      restaurant_id: scopeType === "restaurant" ? legacyId : null,
    },
    rows: unique.map((id) => ({
      zone_id: scopeType === "zone" ? id : null,
      partner_id: scopeType === "partner" ? id : null,
      restaurant_id: scopeType === "restaurant" ? id : null,
    })),
  };
}
