export const STAFF_ACCESS_KINDS = ["manager", "user"] as const;
export type StaffAccessKind = (typeof STAFF_ACCESS_KINDS)[number];

export const RESOURCE_CRUD_MODULES = [
  "drivers",
  "driver_groups",
  "partners",
  "restaurants",
  "vehicles",
  "assets",
  "deliveries",
  "verifications",
  "zones",
  "attendance",
  "requests",
  "wrong_actions",
  "documents",
  "earnings",
  "notifications",
  "support",
] as const;

export type ResourceCrudModule = (typeof RESOURCE_CRUD_MODULES)[number];

export const RESOURCE_CRUD_MODULE_SET = new Set<string>(RESOURCE_CRUD_MODULES);

export const RESOURCE_CRUD_LABELS: Record<
  ResourceCrudModule,
  { noun: string; category: string }
> = {
  drivers: { noun: "drivers", category: "drivers" },
  driver_groups: { noun: "driver groups", category: "drivers" },
  partners: { noun: "partners", category: "partners" },
  restaurants: { noun: "restaurants", category: "restaurants" },
  vehicles: { noun: "vehicles", category: "vehicles" },
  assets: { noun: "assets", category: "assets" },
  deliveries: { noun: "deliveries", category: "deliveries" },
  verifications: { noun: "DPD verifications", category: "deliveries" },
  zones: { noun: "zones", category: "zones" },
  attendance: { noun: "attendance records", category: "attendance" },
  requests: { noun: "requests", category: "requests" },
  wrong_actions: { noun: "wrong actions", category: "compliance" },
  documents: { noun: "document expiry records", category: "compliance" },
  earnings: { noun: "earnings rules", category: "earnings" },
  notifications: { noun: "notifications", category: "notifications" },
  support: { noun: "support threads", category: "support" },
};

const CRUD_VERBS = ["create", "edit", "delete"] as const;

export function parseStaffAccessKind(value: unknown): StaffAccessKind | null {
  if (value === "manager" || value === "user") return value;
  return null;
}

export function isResourceManageSlug(slug: string): boolean {
  if (!slug.endsWith(".manage")) return false;
  return RESOURCE_CRUD_MODULE_SET.has(slug.slice(0, -".manage".length));
}

export function isStaffMatrixSlug(slug: string): boolean {
  return !isResourceManageSlug(slug);
}

export function resourceCrudModuleOf(slug: string): ResourceCrudModule | null {
  const dot = slug.lastIndexOf(".");
  if (dot <= 0) return null;
  const module = slug.slice(0, dot);
  return RESOURCE_CRUD_MODULE_SET.has(module) ? (module as ResourceCrudModule) : null;
}

export function expandRoleSlugToUserTicks(slug: string): string[] {
  if (!isResourceManageSlug(slug)) return [slug];
  const module = slug.slice(0, -".manage".length);
  return CRUD_VERBS.map((verb) => `${module}.${verb}`);
}

export function expandRoleSlugsToUserTicks(slugs: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const slug of slugs) {
    for (const tick of expandRoleSlugToUserTicks(slug)) out.add(tick);
  }
  return out;
}

export function roleSlugsForMatrix(stored: Iterable<string>): Set<string> {
  return expandRoleSlugsToUserTicks(stored);
}

export function roleSlugsForSave(matrixSlugs: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const slug of matrixSlugs) {
    if (!isResourceManageSlug(slug)) out.add(slug);
  }
  for (const module of RESOURCE_CRUD_MODULES) {
    if (
      out.has(`${module}.create`) ||
      out.has(`${module}.edit`) ||
      out.has(`${module}.delete`)
    ) {
      out.add(`${module}.manage`);
    }
  }
  return [...out];
}

/** Manager → User: seed every catalog slug except hidden `.manage` aliases. */
export function managerDowngradeSeedTicks(catalogSlugs: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const slug of catalogSlugs) {
    if (isStaffMatrixSlug(slug)) out.add(slug);
  }
  return out;
}

export function permissionGrantedByTicks(
  ticks: ReadonlySet<string>,
  permission: string,
): boolean {
  if (ticks.has(permission)) return true;
  const module = resourceCrudModuleOf(permission);
  if (!module) return false;
  const verb = permission.slice(module.length + 1);
  if (verb === "manage") {
    return (
      ticks.has(`${module}.create`) ||
      ticks.has(`${module}.edit`) ||
      ticks.has(`${module}.delete`)
    );
  }
  if (verb === "create" || verb === "edit" || verb === "delete") {
    return ticks.has(`${module}.manage`);
  }
  return false;
}

export function resolveSessionPermissionSlugs(input: {
  isSuperAdmin: boolean;
  accessKind: StaffAccessKind | null;
  userTicks: readonly string[] | null;
  roleSlugs: readonly string[];
  catalogSlugs: readonly string[];
}): Set<string> {
  if (input.isSuperAdmin || input.accessKind === "manager") {
    return new Set(input.catalogSlugs);
  }
  if (input.accessKind === "user") {
    return new Set(input.userTicks ?? []);
  }
  return new Set(input.roleSlugs);
}

/** After backfill, every old role slug must still pass the User tick set. */
export function migratedSessionIsSupersetOfRole(
  oldRoleSlugs: readonly string[],
  migratedUserTicks: Iterable<string>,
): boolean {
  const ticks = migratedUserTicks instanceof Set
    ? migratedUserTicks
    : new Set(migratedUserTicks);
  return oldRoleSlugs.every((slug) => permissionGrantedByTicks(ticks, slug));
}
