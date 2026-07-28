export type DriverGroupRow = {
  id: string;
  name: string;
  description: string | null;
  icon_key: string | null;
  member_count: number;
  created_at: string;
  updated_at: string;
};

export type DriverGroupDetail = DriverGroupRow & {
  member_ids: string[];
};

export type DriverGroupMemberOption = {
  id: string;
  driver_code: string;
  employee_id: string;
  full_name: string;
};

export type DriverGroupSummary = {
  id: string;
  name: string;
  icon_key: string | null;
};

export const DRIVER_GROUP_ICONS = [
  "users",
  "star",
  "truck",
  "map-pin",
  "clock",
  "shield",
  "zap",
  "heart",
] as const;

export type DriverGroupIcon = (typeof DRIVER_GROUP_ICONS)[number];
