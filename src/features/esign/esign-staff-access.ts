import { isPenaltyChild } from "./esign-penalty-subcategories";
import { alignPenaltyCategoryKey, isOutgoingHubCategory } from "./outgoing-hub-categories";

export type EsignCategoryGrant = {
  categoryKey: string;
  parentKey?: string | null;
  accessLevel: "sender";
};

export type RequestTypeGrantLevel = "view_only" | "approver";

export type IncomingTypeGrant = {
  requestType: string;
  accessLevel: RequestTypeGrantLevel;
};

export type DeskAccessContext = {
  isSuperAdmin: boolean;
  /** Legacy sender: `requests.manage` (or create/edit/delete alias). */
  hasOutgoingManage: boolean;
  /** Legacy receiver: `requests.view` or `requests.approve`. */
  hasIncomingView: boolean;
};

export function grantsKeyForEsign(rows: readonly EsignCategoryGrant[]): string {
  return [...rows]
    .map((row) => row.categoryKey)
    .sort()
    .join("|");
}

export function canSendEsignCategory(
  categoryKey: string,
  grants: readonly EsignCategoryGrant[],
  ctx: Pick<DeskAccessContext, "isSuperAdmin" | "hasOutgoingManage">,
): boolean {
  if (ctx.isSuperAdmin || ctx.hasOutgoingManage) return true;
  const aligned = alignPenaltyCategoryKey(categoryKey);
  for (const grant of grants) {
    const key = alignPenaltyCategoryKey(grant.categoryKey);
    if (key === aligned) return true;
    if (key === "penalty" && isPenaltyChild({ key: aligned, parent_key: "penalty" })) {
      return true;
    }
    if (aligned === "penalty" && isPenaltyChild({ key, parent_key: grant.parentKey ?? "penalty" })) {
      return true;
    }
  }
  return false;
}

export function outgoingCategoryVisible(
  categoryKey: string,
  grants: readonly EsignCategoryGrant[],
  ctx: Pick<DeskAccessContext, "isSuperAdmin" | "hasOutgoingManage">,
): boolean {
  return canSendEsignCategory(categoryKey, grants, ctx);
}

export function canViewIncomingType(
  requestType: string,
  grants: readonly IncomingTypeGrant[],
  ctx: Pick<DeskAccessContext, "isSuperAdmin" | "hasIncomingView">,
): boolean {
  if (ctx.isSuperAdmin) return true;
  if (grants.length === 0) return ctx.hasIncomingView;
  return grants.some((row) => row.requestType === requestType);
}

export function incomingTypesAllowed(
  allTypes: readonly string[],
  grants: readonly IncomingTypeGrant[],
  ctx: Pick<DeskAccessContext, "isSuperAdmin" | "hasIncomingView">,
): string[] {
  return allTypes.filter((type) => canViewIncomingType(type, grants, ctx));
}

export function hubSenderBadge(
  grants: readonly EsignCategoryGrant[],
  ctx: Pick<DeskAccessContext, "isSuperAdmin" | "hasOutgoingManage">,
): boolean {
  return ctx.isSuperAdmin || ctx.hasOutgoingManage || grants.length > 0;
}

export function hubReceiverBadge(
  grants: readonly IncomingTypeGrant[],
  ctx: Pick<DeskAccessContext, "isSuperAdmin" | "hasIncomingView">,
): boolean {
  return ctx.isSuperAdmin || ctx.hasIncomingView || grants.length > 0;
}

export function esignGrantDocId(profileId: string, categoryKey: string): string {
  return `${profileId}_${alignPenaltyCategoryKey(categoryKey)}`;
}

export function normalizeEsignSenderKeys(keys: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const key of keys) {
    const aligned = alignPenaltyCategoryKey(key.trim());
    if (!aligned || !isOutgoingHubCategory(aligned)) continue;
    unique.add(aligned);
  }
  return [...unique].sort();
}
