import type {
  EffectiveUiPreference,
  ListColumnPreference,
  UiPreferenceSort,
} from "./types";

export function isListColumnPreference(raw: unknown): raw is ListColumnPreference {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.order) || !Array.isArray(o.visible)) return false;
  if (
    o.sort !== null &&
    o.sort !== undefined &&
    (typeof o.sort !== "object" ||
      Array.isArray(o.sort) ||
      typeof (o.sort as UiPreferenceSort).id !== "string" ||
      !["asc", "desc"].includes((o.sort as UiPreferenceSort).dir))
  ) {
    return false;
  }
  return true;
}

export function normalizeListColumnPreference(
  raw: unknown,
  knownIds: string[],
  system: ListColumnPreference,
): ListColumnPreference {
  if (!isListColumnPreference(raw)) return system;
  const known = new Set(knownIds);
  // A column added after the preference was saved lands beside its default
  // neighbour with its default visibility, not hidden at the end.
  const order = raw.order.filter((id) => known.has(id));
  const added: string[] = [];
  knownIds.forEach((id, index) => {
    if (order.includes(id)) return;
    added.push(id);
    const prev = knownIds.slice(0, index).reverse().find((p) => order.includes(p));
    order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, id);
  });
  const visible = [
    ...raw.visible.filter((id) => known.has(id)),
    ...added.filter((id) => system.visible.includes(id)),
  ];
  const sort =
    raw.sort && known.has(raw.sort.id)
      ? { id: raw.sort.id, dir: raw.sort.dir }
      : system.sort && known.has(system.sort.id)
        ? system.sort
        : null;
  return {
    order,
    visible: visible.length > 0 ? visible : [...system.visible],
    sort,
  };
}

export function resolveUiPreference<T>(args: {
  system: T;
  role: T | null;
  user: T | null;
}): EffectiveUiPreference<T> {
  if (args.user != null) {
    return {
      effective: args.user,
      source: "user",
      roleDefault: args.role,
      userOverride: args.user,
    };
  }
  if (args.role != null) {
    return {
      effective: args.role,
      source: "role",
      roleDefault: args.role,
      userOverride: null,
    };
  }
  return {
    effective: args.system,
    source: "system",
    roleDefault: null,
    userOverride: null,
  };
}
