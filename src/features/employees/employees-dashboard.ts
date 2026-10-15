export type EmployeesDashboardBucket = {
  key: string;
  count: number;
};

export type EmployeesDashboard = {
  total: number;
  archived: number;
  by_project: EmployeesDashboardBucket[];
  by_partner: EmployeesDashboardBucket[];
  by_employee_status: EmployeesDashboardBucket[];
  by_nationality_category: EmployeesDashboardBucket[];
  by_section: EmployeesDashboardBucket[];
};

export type EmployeesDashboardRow = {
  archived: boolean;
  project_key: string | null;
  partner_id: string | null;
  employee_status_key: string | null;
  nationality_category_keys: string[];
  section_keys: string[];
};

const UNASSIGNED = "unassigned";

function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function toBuckets(map: Map<string, number>): EmployeesDashboardBucket[] {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function aggregateEmployeesDashboard(rows: readonly EmployeesDashboardRow[]): EmployeesDashboard {
  const project = new Map<string, number>();
  const partner = new Map<string, number>();
  const status = new Map<string, number>();
  const nationality = new Map<string, number>();
  const section = new Map<string, number>();
  let archived = 0;

  for (const row of rows) {
    if (row.archived) {
      archived += 1;
      continue;
    }
    bump(project, row.project_key || UNASSIGNED);
    bump(partner, row.partner_id || UNASSIGNED);
    bump(status, row.employee_status_key || UNASSIGNED);
    if (row.nationality_category_keys.length === 0) bump(nationality, UNASSIGNED);
    else for (const key of row.nationality_category_keys) bump(nationality, key);
    if (row.section_keys.length === 0) bump(section, UNASSIGNED);
    else for (const key of row.section_keys) bump(section, key);
  }

  return {
    total: rows.length - archived,
    archived,
    by_project: toBuckets(project),
    by_partner: toBuckets(partner),
    by_employee_status: toBuckets(status),
    by_nationality_category: toBuckets(nationality),
    by_section: toBuckets(section),
  };
}
