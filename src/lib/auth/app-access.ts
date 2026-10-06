import { LAUNCHER_TILE_IDS, type LauncherTileId } from "@/lib/menu/launcher-modules";
import { RESOURCE_CRUD_MODULE_SET, type ResourceCrudModule } from "@/lib/auth/staff-access";

export const APP_ACCESS_LEVELS = ["none", "viewer", "user", "manager"] as const;
export type AppAccessLevel = (typeof APP_ACCESS_LEVELS)[number];

export const STAFF_DEPARTMENTS = ["hr", "accounts", "admin", "operations_fleet"] as const;
export type StaffDepartment = (typeof STAFF_DEPARTMENTS)[number];

export function parseStaffDepartment(value: unknown): StaffDepartment | null {
  if (typeof value !== "string") return null;
  return STAFF_DEPARTMENTS.includes(value as StaffDepartment)
    ? (value as StaffDepartment)
    : null;
}

export type AppSubViewDef = {
  id: string;
  labelKey: string;
  slugs: readonly string[];
};

export type AppAccessEntry = {
  appId: LauncherTileId;
  crudModule?: ResourceCrudModule;
  extraViewer?: readonly string[];
  extraUser?: readonly string[];
  extraManager?: readonly string[];
  subViews: readonly AppSubViewDef[];
  rcm?: boolean;
};

export type AppAccessItem = {
  appId: LauncherTileId;
  level: AppAccessLevel;
  custom: boolean;
  subViews: string[];
  sender?: boolean;
  receiver?: boolean;
};

export type AppAccessMap = Record<LauncherTileId, AppAccessItem>;

export type AccessDiff = {
  addedApps: LauncherTileId[];
  removedApps: LauncherTileId[];
  levelChanges: { appId: LauncherTileId; from: AppAccessLevel; to: AppAccessLevel }[];
  subViewAdds: { appId: LauncherTileId; id: string }[];
  subViewRemoves: { appId: LauncherTileId; id: string }[];
  sideChanges: number;
  changeCount: number;
};

const LEVEL_RANK: Record<AppAccessLevel, number> = {
  none: 0,
  viewer: 1,
  user: 2,
  manager: 3,
};

function crudVerbs(module: ResourceCrudModule, level: AppAccessLevel): string[] {
  if (level === "none") return [];
  const slugs = [`${module}.view`];
  if (level === "user" || level === "manager") {
    slugs.push(`${module}.create`, `${module}.edit`);
  }
  if (level === "manager") {
    slugs.push(`${module}.delete`, `${module}.bulk_delete`);
  }
  return slugs;
}

export const APP_ACCESS_CATALOG: readonly AppAccessEntry[] = [
  { appId: "dashboard-ops", extraViewer: ["dashboard.view"], subViews: [] },
  { appId: "live-tracking-v2", extraViewer: ["live_tracking.view"], subViews: [] },
  { appId: "driver-groups", crudModule: "driver_groups", subViews: [] },
  {
    appId: "drivers",
    crudModule: "drivers",
    extraManager: ["driver_ops.export", "driver_telemetry.export", "driver_devices.export"],
    subViews: [
      { id: "activity", labelKey: "subViews.activity", slugs: ["driver_ops.view"] },
      { id: "diagnostics", labelKey: "subViews.diagnostics", slugs: ["driver_telemetry.view"] },
      { id: "devices", labelKey: "subViews.devices", slugs: ["driver_devices.view"] },
    ],
  },
  {
    appId: "deliveries",
    crudModule: "deliveries",
    subViews: [
      { id: "orderRecon", labelKey: "subViews.orderRecon", slugs: ["order_recon.view"] },
    ],
  },
  {
    appId: "employeedesk",
    crudModule: "requests",
    extraViewer: ["employeedesk.view"],
    extraManager: ["employeedesk.manage", "esign.bulk_delete"],
    rcm: true,
    subViews: [{ id: "toSign", labelKey: "subViews.toSign", slugs: ["esign.sign"] }],
  },
  {
    appId: "visit-bookings",
    extraViewer: ["visits.view"],
    extraManager: ["visits.bulk_delete"],
    subViews: [
      { id: "operate", labelKey: "subViews.visitOperate", slugs: ["visits.operate"] },
      { id: "catalog", labelKey: "subViews.visitCatalog", slugs: ["visits.manage_catalog"] },
    ],
  },
  { appId: "dpd-verification", crudModule: "verifications", subViews: [] },
  { appId: "earnings", crudModule: "earnings", subViews: [] },
  { appId: "restaurants", crudModule: "restaurants", subViews: [] },
  {
    appId: "notifications",
    crudModule: "notifications",
    extraViewer: ["notifications.export"],
    subViews: [
      { id: "send", labelKey: "subViews.notifySend", slugs: ["notifications.send"] },
      { id: "approve", labelKey: "subViews.notifyApprove", slugs: ["notifications.approve"] },
    ],
  },
  { appId: "attendance", crudModule: "attendance", subViews: [] },
  {
    appId: "roles",
    extraViewer: ["roles.manage"],
    subViews: [{ id: "users", labelKey: "subViews.users", slugs: ["users.manage"] }],
  },
  {
    appId: "profile",
    extraViewer: ["settings.view"],
    extraUser: ["settings.manage"],
    extraManager: ["audit.export", "data.cleanup"],
    subViews: [
      { id: "companies", labelKey: "subViews.companies", slugs: ["companies.view"] },
      { id: "activityLog", labelKey: "subViews.activityLog", slugs: ["audit.view"] },
    ],
  },
  { appId: "document-expiry", crudModule: "documents", subViews: [] },
  { appId: "driver-app", extraViewer: [], subViews: [] },
  {
    appId: "assets",
    crudModule: "assets",
    subViews: [
      { id: "assetRequests", labelKey: "subViews.assetRequests", slugs: ["asset_requests.view"] },
    ],
  },
  {
    appId: "operations-hub",
    extraViewer: ["partners.view", "zones.view"],
    extraUser: [
      "partners.create",
      "partners.edit",
      "zones.create",
      "zones.edit",
    ],
    extraManager: [
      "partners.delete",
      "partners.bulk_delete",
      "zones.delete",
      "zones.bulk_delete",
    ],
    subViews: [],
  },
  {
    appId: "vehicles",
    crudModule: "vehicles",
    subViews: [
      { id: "fuel", labelKey: "subViews.fuel", slugs: ["fuel.view"] },
      { id: "fuelRequests", labelKey: "subViews.fuelRequests", slugs: ["fuel_requests.view"] },
      { id: "fuelRefunds", labelKey: "subViews.fuelRefunds", slugs: ["fuel_refunds.view"] },
    ],
  },
  {
    appId: "payroll",
    crudModule: "payroll",
    extraViewer: ["payroll.export"],
    subViews: [],
  },
  {
    appId: "performance",
    extraViewer: ["performance.view", "performance.export"],
    extraManager: ["performance.manage_teams"],
    subViews: [
      { id: "analyze", labelKey: "subViews.analyze", slugs: ["performance.analyze"] },
      { id: "rate", labelKey: "subViews.rate", slugs: ["performance.rate"] },
    ],
  },
  { appId: "assistant", extraViewer: ["assistant.view"], subViews: [] },
];

const CATALOG_BY_ID = new Map(APP_ACCESS_CATALOG.map((entry) => [entry.appId, entry]));

export function appAccessEntry(appId: string): AppAccessEntry | undefined {
  return CATALOG_BY_ID.get(appId as LauncherTileId);
}

function extrasAt(entry: AppAccessEntry, level: AppAccessLevel): string[] {
  const slugs: string[] = [];
  if (LEVEL_RANK[level] >= 1) slugs.push(...(entry.extraViewer ?? []));
  if (LEVEL_RANK[level] >= 2) slugs.push(...(entry.extraUser ?? []));
  if (LEVEL_RANK[level] >= 3) slugs.push(...(entry.extraManager ?? []));
  return slugs;
}

/** Level-controlled slugs only — no sub-views, no RCM sides. */
export function slugsForLevel(entry: AppAccessEntry, level: AppAccessLevel): string[] {
  if (level === "none") return [];
  const slugs: string[] = [];
  if (entry.crudModule && RESOURCE_CRUD_MODULE_SET.has(entry.crudModule)) {
    slugs.push(...crudVerbs(entry.crudModule, level));
  }
  slugs.push(...extrasAt(entry, level));
  return [...new Set(slugs)];
}

export function rcmSideSlugs(level: AppAccessLevel, sides: { sender: boolean; receiver: boolean }): string[] {
  if (level === "none") return [];
  const slugs: string[] = [];
  if (sides.receiver) {
    slugs.push("requests.view", "requests.approve");
  }
  if (sides.sender && (level === "user" || level === "manager")) {
    slugs.push("requests.create", "requests.edit");
  }
  if (sides.sender && level === "manager") {
    slugs.push("requests.delete", "requests.bulk_delete");
  }
  return slugs;
}

export function defaultRcmSides(level: AppAccessLevel): { sender: boolean; receiver: boolean } {
  if (level === "none") return { sender: false, receiver: false };
  if (level === "viewer") return { sender: false, receiver: true };
  return { sender: true, receiver: true };
}

export function slugsForApp(
  entry: AppAccessEntry,
  item: Pick<AppAccessItem, "level" | "subViews" | "sender" | "receiver">,
): string[] {
  const slugs = new Set<string>();
  if (entry.appId === "driver-app") {
    if (item.level !== "none") slugs.add("settings.manage");
    return [...slugs];
  }
  if (entry.rcm) {
    const sides = {
      sender: item.sender === true,
      receiver: item.receiver === true,
    };
    for (const slug of slugsForLevel(entry, item.level)) {
      if (slug.startsWith("requests.")) continue;
      slugs.add(slug);
    }
    for (const slug of rcmSideSlugs(item.level, sides)) slugs.add(slug);
  } else {
    for (const slug of slugsForLevel(entry, item.level)) slugs.add(slug);
  }
  if (item.level !== "none") {
    for (const view of entry.subViews) {
      if (!item.subViews.includes(view.id)) continue;
      for (const slug of view.slugs) slugs.add(slug);
    }
  }
  return [...slugs];
}

const OWNED_SLUGS: ReadonlySet<string> = (() => {
  const owned = new Set<string>();
  for (const entry of APP_ACCESS_CATALOG) {
    for (const slug of slugsForLevel(entry, "manager")) owned.add(slug);
    for (const view of entry.subViews) {
      for (const slug of view.slugs) owned.add(slug);
    }
    if (entry.rcm) {
      for (const slug of rcmSideSlugs("manager", { sender: true, receiver: true })) {
        owned.add(slug);
      }
    }
  }
  return owned;
})();

export function ownedAccessSlugs(): ReadonlySet<string> {
  return OWNED_SLUGS;
}

export function preservedUnknownSlugs(ticks: Iterable<string>): string[] {
  const out: string[] = [];
  for (const slug of ticks) {
    if (!OWNED_SLUGS.has(slug)) out.push(slug);
  }
  return out;
}

function hasAll(ticks: ReadonlySet<string>, slugs: readonly string[]): boolean {
  return slugs.every((slug) => ticks.has(slug));
}

function inferLevel(entry: AppAccessEntry, ticks: ReadonlySet<string>): {
  level: AppAccessLevel;
  custom: boolean;
} {
  const manager = slugsForLevel(entry, "manager").filter((slug) =>
    entry.rcm ? !slug.startsWith("requests.") : true,
  );
  const user = slugsForLevel(entry, "user").filter((slug) =>
    entry.rcm ? !slug.startsWith("requests.") : true,
  );
  const viewer = slugsForLevel(entry, "viewer").filter((slug) =>
    entry.rcm ? !slug.startsWith("requests.") : true,
  );

  if (entry.rcm) {
    const hasDelete = ticks.has("requests.delete") || ticks.has("requests.bulk_delete");
    const hasWrite = ticks.has("requests.create") || ticks.has("requests.edit");
    const hasRead = ticks.has("requests.view") || ticks.has("requests.approve");
    const extras = extrasAt(entry, "manager").filter((slug) => ticks.has(slug));
    if (!hasDelete && !hasWrite && !hasRead && extras.length === 0) {
      return { level: "none", custom: false };
    }
    if (hasDelete && ticks.has("requests.bulk_delete") && hasAll(ticks, user)) {
      const extraBeyond = manager.some((slug) => !user.includes(slug) && !ticks.has(slug));
      return { level: "manager", custom: extraBeyond || !ticks.has("requests.create") };
    }
    if (hasDelete) return { level: "user", custom: true };
    if (hasWrite && hasAll(ticks, user.filter((s) => !s.startsWith("requests.")))) {
      return { level: "user", custom: !ticks.has("requests.create") || !ticks.has("requests.edit") };
    }
    if (hasWrite) return { level: "viewer", custom: true };
    if (hasRead || extras.length > 0) {
      const cleanViewer = hasRead && extras.every((slug) => viewer.includes(slug));
      return { level: "viewer", custom: !cleanViewer && extras.some((slug) => !viewer.includes(slug)) };
    }
    return { level: "none", custom: extras.length > 0 };
  }

  if (manager.length === 0 && user.length === 0 && viewer.length === 0) {
    return { level: "none", custom: false };
  }
  if (hasAll(ticks, manager) && manager.length > 0) {
    return { level: "manager", custom: false };
  }
  if (hasAll(ticks, user) && user.length > 0) {
    const extra = manager.some((slug) => !user.includes(slug) && ticks.has(slug));
    return { level: extra ? "user" : "user", custom: extra };
  }
  if (hasAll(ticks, viewer) && viewer.length > 0) {
    const extra = [...user, ...manager].some((slug) => !viewer.includes(slug) && ticks.has(slug));
    return { level: "viewer", custom: extra };
  }
  const any = [...manager].some((slug) => ticks.has(slug));
  if (any) return { level: "viewer", custom: true };
  return { level: "none", custom: false };
}

function emptyItem(appId: LauncherTileId, entry: AppAccessEntry): AppAccessItem {
  return {
    appId,
    level: "none",
    custom: false,
    subViews: [],
    ...(entry.rcm ? { sender: false, receiver: false } : {}),
  };
}

export function emptyAppAccess(): AppAccessMap {
  const map = {} as AppAccessMap;
  for (const entry of APP_ACCESS_CATALOG) {
    map[entry.appId] = emptyItem(entry.appId, entry);
  }
  return map;
}

export function ticksToAppAccess(ticks: Iterable<string>): AppAccessMap {
  const set = ticks instanceof Set ? ticks : new Set(ticks);
  const map = emptyAppAccess();
  for (const entry of APP_ACCESS_CATALOG) {
    const inferred = inferLevel(entry, set);
    const subViews =
      inferred.level === "none"
        ? []
        : entry.subViews.filter((view) => hasAll(set, view.slugs)).map((view) => view.id);
    const item: AppAccessItem = {
      appId: entry.appId,
      level: inferred.level,
      custom: inferred.custom,
      subViews,
    };
    if (entry.appId === "driver-app") {
      item.level = set.has("settings.manage") ? "viewer" : "none";
      item.custom = false;
      item.subViews = [];
    }
    if (entry.rcm) {
      item.receiver = set.has("requests.view") || set.has("requests.approve");
      item.sender =
        set.has("requests.create") || set.has("requests.edit") || set.has("requests.delete");
      if (item.level === "none" && (item.receiver || item.sender)) {
        item.level = "viewer";
      }
    }
    map[entry.appId] = item;
  }
  return map;
}

export function appAccessToTicks(
  state: AppAccessMap,
  preservedUnknown: Iterable<string> = [],
): string[] {
  const next = new Set(preservedUnknown);
  for (const entry of APP_ACCESS_CATALOG) {
    const item = state[entry.appId] ?? emptyItem(entry.appId, entry);
    for (const slug of slugsForApp(entry, item)) next.add(slug);
  }
  return [...next];
}

export function modulesSelectedCount(ticks: Iterable<string>): number {
  const access = ticksToAppAccess(ticks);
  return APP_ACCESS_CATALOG.filter((entry) => access[entry.appId].level !== "none").length;
}

export function modulesSelectedFromAccess(state: AppAccessMap): number {
  return APP_ACCESS_CATALOG.filter((entry) => state[entry.appId]?.level !== "none").length;
}

export function setAppLevel(
  state: AppAccessMap,
  appId: LauncherTileId,
  level: AppAccessLevel,
): AppAccessMap {
  const entry = CATALOG_BY_ID.get(appId);
  if (!entry) return state;
  const prev = state[appId] ?? emptyItem(appId, entry);
  const next: AppAccessItem = {
    ...prev,
    level,
    custom: false,
    subViews: level === "none" ? [] : prev.subViews,
  };
  if (entry.rcm) {
    const sides = defaultRcmSides(level);
    next.sender = sides.sender;
    next.receiver = sides.receiver;
  }
  return { ...state, [appId]: next };
}

export function toggleAppSubView(
  state: AppAccessMap,
  appId: LauncherTileId,
  subViewId: string,
): AppAccessMap {
  const entry = CATALOG_BY_ID.get(appId);
  if (!entry) return state;
  const prev = state[appId] ?? emptyItem(appId, entry);
  if (prev.level === "none") return state;
  const on = prev.subViews.includes(subViewId);
  return {
    ...state,
    [appId]: {
      ...prev,
      subViews: on ? prev.subViews.filter((id) => id !== subViewId) : [...prev.subViews, subViewId],
    },
  };
}

export function setRcmSides(
  state: AppAccessMap,
  sides: { sender: boolean; receiver: boolean },
): AppAccessMap {
  const prev = state.employeedesk;
  if (!prev) return state;
  const bothOff = !sides.sender && !sides.receiver;
  return {
    ...state,
    employeedesk: {
      ...prev,
      sender: sides.sender,
      receiver: sides.receiver,
      level: bothOff ? "none" : prev.level === "none" ? "viewer" : prev.level,
      subViews: bothOff ? [] : prev.subViews,
      custom: false,
    },
  };
}

export function diffAccess(before: AppAccessMap, after: AppAccessMap): AccessDiff {
  const addedApps: LauncherTileId[] = [];
  const removedApps: LauncherTileId[] = [];
  const levelChanges: AccessDiff["levelChanges"] = [];
  const subViewAdds: AccessDiff["subViewAdds"] = [];
  const subViewRemoves: AccessDiff["subViewRemoves"] = [];
  let sideChanges = 0;

  for (const entry of APP_ACCESS_CATALOG) {
    const a = before[entry.appId] ?? emptyItem(entry.appId, entry);
    const b = after[entry.appId] ?? emptyItem(entry.appId, entry);
    const aOn = a.level !== "none";
    const bOn = b.level !== "none";
    if (!aOn && bOn) addedApps.push(entry.appId);
    if (aOn && !bOn) removedApps.push(entry.appId);
    if (a.level !== b.level && aOn && bOn) {
      levelChanges.push({ appId: entry.appId, from: a.level, to: b.level });
    }
    const beforeViews = new Set(a.subViews);
    const afterViews = new Set(b.subViews);
    for (const id of afterViews) {
      if (!beforeViews.has(id)) subViewAdds.push({ appId: entry.appId, id });
    }
    for (const id of beforeViews) {
      if (!afterViews.has(id)) subViewRemoves.push({ appId: entry.appId, id });
    }
    if (entry.rcm) {
      if (Boolean(a.sender) !== Boolean(b.sender)) sideChanges += 1;
      if (Boolean(a.receiver) !== Boolean(b.receiver)) sideChanges += 1;
    }
  }

  const changeCount =
    addedApps.length +
    removedApps.length +
    levelChanges.length +
    subViewAdds.length +
    subViewRemoves.length +
    sideChanges;

  return {
    addedApps,
    removedApps,
    levelChanges,
    subViewAdds,
    subViewRemoves,
    sideChanges,
    changeCount,
  };
}

export function copyAccess(
  source: AppAccessMap,
  target: AppAccessMap,
  keepSubViews: boolean,
): AppAccessMap {
  const next = emptyAppAccess();
  for (const entry of APP_ACCESS_CATALOG) {
    const from = source[entry.appId] ?? emptyItem(entry.appId, entry);
    const current = target[entry.appId] ?? emptyItem(entry.appId, entry);
    next[entry.appId] = {
      ...from,
      custom: false,
      subViews: keepSubViews && from.level !== "none" ? current.subViews : from.subViews,
    };
  }
  return next;
}

export function catalogCoversLauncherTiles(): boolean {
  const ids = new Set(APP_ACCESS_CATALOG.map((entry) => entry.appId));
  return LAUNCHER_TILE_IDS.every((id) => ids.has(id));
}
