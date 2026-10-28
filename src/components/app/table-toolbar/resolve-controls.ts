import type { ResolvedToolbarControls, TableToolbarConfig } from "./toolbar-config";

/** Hide rules. Returns null when every control would be hidden — render no toolbar. */
export function resolveToolbarControls(
  config: TableToolbarConfig,
): ResolvedToolbarControls | null {
  const searchHidden =
    config.rowKind === "fixed" && (config.fixedRows ?? 0) < 10;
  const categorical = config.columns.some((column) => column.categorical);
  const groupBy = categorical && config.rowKind !== "aggregate";
  const grid = config.entityList === true;
  const columns = config.columns.length > 4;
  const search = !searchHidden;
  const exportAction = typeof config.exportAction === "function";
  const add = typeof config.addAction === "function";
  const resolved: ResolvedToolbarControls = {
    search,
    groupBy,
    grid,
    columns,
    export: exportAction,
    add,
  };
  const any =
    resolved.search ||
    resolved.groupBy ||
    resolved.grid ||
    resolved.columns ||
    resolved.export ||
    resolved.add;
  if (!any) return null;
  return resolved;
}
