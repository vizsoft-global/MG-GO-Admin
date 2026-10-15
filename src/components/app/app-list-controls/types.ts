export type ListSearchFieldOption = {
  value: string;
  label: string;
};

export type ListGroupByOption = {
  value: string;
  label: string;
};

export type ListViewMode = "table" | "cards";

export type GroupedRows<T> = {
  key: string;
  label: string;
  rows: T[];
};
