import type { Permission } from "@/lib/auth/permissions";
import { permissionGrantedByTicks } from "@/lib/auth/staff-access";

/**
 * Clear all — the modules `admin_purge_run_all` can empty in one go.
 *
 * `slug` is the per-module `*.bulk_delete` tick the database gate checks, and it
 * is deliberately *not* an alias of `*.manage` / `*.delete`: holding either of
 * those clears nothing, because clearing is not the same decision as deleting
 * one row. Entities that ship no CRUD of their own borrow their parent's tick
 * (delivery rules and payouts are `earnings.bulk_delete`), which is why some
 * slugs repeat.
 */
export type PurgeAllModule = {
  entity: PurgeAllEntity;
  slug: Permission;
  /**
   * Recommended go-live order (1 first). Clearing a parent while a child still
   * points at it is refused by the database, so the panel sorts on this and the
   * banner explains why deliveries go before zones.
   */
  goLive: 1 | 2 | 3 | 4 | 5 | 6;
};

export const PURGE_ALL_ENTITIES = [
  "deliveries",
  "attendance",
  "earnings",
  "payouts",
  "requests",
  "visits",
  "notifications",
  "esign",
  "drivers",
  "driver_groups",
  "vehicles",
  "assets",
  "fuel",
  "restaurants",
  "zones",
  "partners",
  "companies",
  "delivery_rules",
  "incentive_rules",
  "wrong_actions",
  "documents",
  "order_recon",
  "verifications",
  "payroll",
] as const;

export type PurgeAllEntity = (typeof PURGE_ALL_ENTITIES)[number];

export const PURGE_ALL_MODULES: readonly PurgeAllModule[] = [
  { entity: "deliveries", slug: "deliveries.bulk_delete", goLive: 1 },
  { entity: "attendance", slug: "attendance.bulk_delete", goLive: 1 },
  { entity: "earnings", slug: "earnings.bulk_delete", goLive: 1 },
  { entity: "payouts", slug: "earnings.bulk_delete", goLive: 1 },
  { entity: "requests", slug: "requests.bulk_delete", goLive: 2 },
  { entity: "visits", slug: "visits.bulk_delete", goLive: 2 },
  { entity: "notifications", slug: "notifications.bulk_delete", goLive: 2 },
  { entity: "esign", slug: "esign.bulk_delete", goLive: 2 },
  { entity: "drivers", slug: "drivers.bulk_delete", goLive: 3 },
  { entity: "driver_groups", slug: "driver_groups.bulk_delete", goLive: 3 },
  { entity: "vehicles", slug: "vehicles.bulk_delete", goLive: 4 },
  { entity: "assets", slug: "assets.bulk_delete", goLive: 4 },
  { entity: "fuel", slug: "fuel.bulk_delete", goLive: 4 },
  { entity: "restaurants", slug: "restaurants.bulk_delete", goLive: 5 },
  { entity: "zones", slug: "zones.bulk_delete", goLive: 5 },
  { entity: "partners", slug: "partners.bulk_delete", goLive: 5 },
  { entity: "companies", slug: "companies.bulk_delete", goLive: 5 },
  { entity: "delivery_rules", slug: "earnings.bulk_delete", goLive: 5 },
  { entity: "incentive_rules", slug: "earnings.bulk_delete", goLive: 5 },
  { entity: "wrong_actions", slug: "wrong_actions.bulk_delete", goLive: 6 },
  { entity: "documents", slug: "documents.bulk_delete", goLive: 6 },
  { entity: "order_recon", slug: "order_recon.bulk_delete", goLive: 6 },
  { entity: "verifications", slug: "verifications.bulk_delete", goLive: 6 },
  { entity: "payroll", slug: "payroll.bulk_delete", goLive: 6 },
];

const MODULE_BY_ENTITY = new Map<string, PurgeAllModule>(
  PURGE_ALL_MODULES.map((module) => [module.entity, module]),
);

export const PURGE_ALL_ENTITY_SET: ReadonlySet<string> = new Set(
  PURGE_ALL_MODULES.map((module) => module.entity),
);

export function purgeAllModuleFor(entity: string): PurgeAllModule | null {
  return MODULE_BY_ENTITY.get(entity) ?? null;
}

export function isPurgeAllEntity(value: unknown): value is PurgeAllEntity {
  return typeof value === "string" && PURGE_ALL_ENTITY_SET.has(value);
}

/**
 * The modules this operator may clear, in recommended order. The database is
 * still the lock — this only decides what the panel is allowed to draw, so a
 * module the operator cannot clear never renders a button that would fail.
 */
export function purgeAllEntitiesForPermissions(
  permissions: ReadonlySet<string>,
  isSuperAdmin: boolean,
): PurgeAllEntity[] {
  return PURGE_ALL_MODULES.filter(
    (module) => isSuperAdmin || permissionGrantedByTicks(permissions, module.slug),
  ).map((module) => module.entity);
}

export function purgeAllModulesForEntities(
  entities: readonly PurgeAllEntity[],
): PurgeAllModule[] {
  const wanted = new Set<string>(entities);
  return PURGE_ALL_MODULES.filter((module) => wanted.has(module.entity));
}
