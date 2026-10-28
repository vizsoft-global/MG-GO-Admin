export type TableToolbarColumn = {
  id: string;
  label: string;
  /** ID and Name stay visible and cannot be reordered off. */
  locked?: boolean;
  defaultHidden?: boolean;
  /** Group by lists only these columns. */
  categorical?: boolean;
};

export type TableRowKind = "fixed" | "dynamic" | "aggregate";

export type TableViewMode = "list" | "grid";

export type TableToolbarConfig = {
  tableId: string;
  /** Placeholder reads "Search {entity}…". */
  entity: string;
  columns: TableToolbarColumn[];
  rowKind: TableRowKind;
  /** Required when rowKind is "fixed". Search hides below 10. */
  fixedRows?: number;
  /** List/Grid toggle only on entity lists. */
  entityList?: boolean;
  exportAction?: () => void;
  addAction?: () => void;
};

export type ResolvedToolbarControls = {
  search: boolean;
  groupBy: boolean;
  grid: boolean;
  columns: boolean;
  export: boolean;
  add: boolean;
};
