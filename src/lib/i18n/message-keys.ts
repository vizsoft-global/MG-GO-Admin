type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export function flattenMessages(
  obj: JsonObject,
  prefix = "",
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flattenMessages(value as JsonObject, path));
    } else if (typeof value === "string") {
      out[path] = value;
    }
  }
  return out;
}

export function unflattenMessages(flat: Record<string, string>): JsonObject {
  const root: JsonObject = {};
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split(".");
    let cur: JsonObject = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]!;
      if (!(p in cur) || typeof cur[p] !== "object" || cur[p] === null) {
        cur[p] = {};
      }
      cur = cur[p] as JsonObject;
    }
    cur[parts[parts.length - 1]!] = value;
  }
  return root;
}

export function countMissingKeys(
  source: Record<string, string>,
  target: Record<string, string>,
): number {
  let missing = 0;
  for (const key of Object.keys(source)) {
    const val = target[key]?.trim();
    if (!val) missing++;
  }
  return missing;
}
