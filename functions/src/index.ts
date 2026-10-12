/**
 * FUNCTION_TARGET gate.
 *
 * Unset (deploy analysis and local full load): every legacy callable plus
 * adminApi, adminApiScan, and adminApiHeavy. Set: only that export, so one
 * Cloud Run instance does not construct the other handlers.
 *
 * Stage D: register a new callable in `router/legacy-modules.ts` and a lane in
 * `router/lanes.ts`. This file no longer has static `export { } from` lines.
 * Keep `import "./core/init"` first. Do not call setGlobalOptions again.
 */
import "./core/init";
import { createRequire } from "node:module";
import { LEGACY_MODULES, moduleForFunction } from "./router/legacy-modules";
import { LANE_EXPORT_NAMES, laneIdForExport } from "./router/lanes";

export type { StaffClaims } from "./rpcs/sync-staff-claims";

const requireFromIndex = createRequire(__filename);

function publish(name: string, value: unknown): void {
  const cached = requireFromIndex.cache[__filename];
  if (!cached) throw new Error("functions index is not in require.cache");
  Object.defineProperty(cached.exports, name, {
    enumerable: true,
    configurable: true,
    writable: true,
    value,
  });
}

function loadModule(fromIndex: string): Record<string, unknown> {
  // FUNCTION_TARGET gate: dynamic require so one instance does not evaluate every callable.
  return requireFromIndex(fromIndex) as Record<string, unknown>;
}

const target = process.env.FUNCTION_TARGET?.trim() ?? "";

if (!target) {
  for (const [modulePath, names] of Object.entries(LEGACY_MODULES)) {
    const loaded = loadModule(modulePath);
    for (const name of names) {
      if (!(name in loaded)) throw new Error(`legacy export missing: ${name} from ${modulePath}`);
      publish(name, loaded[name]);
    }
  }
  const router = loadModule("./router/admin-api");
  for (const name of LANE_EXPORT_NAMES) {
    publish(name, router[name]);
  }
} else if (laneIdForExport(target)) {
  const router = loadModule("./router/admin-api");
  if (router[target] == null) throw new Error(`router lane was not built: ${target}`);
  publish(target, router[target]);
} else {
  const modulePath = moduleForFunction(target);
  if (!modulePath) throw new Error(`FUNCTION_TARGET is not a known export: ${target}`);
  const loaded = loadModule(modulePath);
  if (!(target in loaded)) throw new Error(`FUNCTION_TARGET missing from ${modulePath}: ${target}`);
  publish(target, loaded[target]);
}
