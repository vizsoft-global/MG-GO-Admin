import ExcelJS from "exceljs";
import { INCENTIVE_IMPORT_COLUMNS } from "./incentive-rule-import";
import type { IncentiveRuleRow } from "./types";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1E3A5F" },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 11,
};

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });
  row.height = 20;
}

function formatTiers(rule: IncentiveRuleRow): string {
  if (rule.target_mode === "tiered" && rule.tiers.length > 0) {
    return rule.tiers
      .map((tier) => {
        if (tier.reward_mode === "per_delivery") {
          return `${tier.threshold_deliveries}:per_delivery:${tier.reward_per_delivery_kwd ?? 0}`;
        }
        return `${tier.threshold_deliveries}=${tier.reward_kwd ?? 0}`;
      })
      .join(";");
  }
  if (rule.reward_mode === "per_delivery") {
    return `${rule.target_deliveries ?? rule.base_minimum_deliveries}:per_delivery:${rule.reward_per_delivery_kwd ?? 0}`;
  }
  return `${rule.target_deliveries ?? rule.base_minimum_deliveries}=${rule.reward_kwd}`;
}

/**
 * The export sheet uses the same catalogue as the import template, so an
 * exported workbook can be edited and re-imported without the operator having
 * to re-key the shape of each rule.
 */
function incentiveRuleExportCells(rule: IncentiveRuleRow): (string | number)[] {
  const byKey: Record<string, string | number> = {
    name: rule.name,
    restaurant: rule.scope_label,
    start: rule.start_date,
    end: rule.end_date,
    targetType: rule.target_mode,
    target: rule.target_deliveries ?? "",
    rewardType: rule.reward_mode,
    reward: rule.reward_mode === "fixed" ? rule.reward_kwd : "",
    rate: rule.reward_mode === "per_delivery" ? (rule.reward_per_delivery_kwd ?? 0) : "",
    baseMinimum: rule.base_minimum_deliveries,
    tiers: rule.target_mode === "tiered" ? formatTiers(rule) : "",
    period: rule.period,
    priority: rule.priority,
    override: rule.overrides_others ? "yes" : "no",
    status: rule.status,
  };
  return INCENTIVE_IMPORT_COLUMNS.map((column) => byKey[column.key] ?? "");
}

export async function buildIncentiveRulesWorkbook(
  rules: IncentiveRuleRow[],
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "DPD Admin";

  const sheet = wb.addWorksheet("Incentive rules");
  sheet.addRow(INCENTIVE_IMPORT_COLUMNS.map((column) => column.header));
  styleHeader(sheet.getRow(1));
  for (const rule of rules) {
    sheet.addRow(incentiveRuleExportCells(rule));
  }
  sheet.columns = INCENTIVE_IMPORT_COLUMNS.map((column) => {
    if (column.key === "tiers") return { width: 28 };
    if (column.key === "name" || column.key === "restaurant") return { width: 26 };
    if (column.key === "rate" || column.key === "baseMinimum") return { width: 18 };
    return { width: 13 };
  });

  const guide = wb.addWorksheet("Guide");
  guide.addRow(["Column", "Required", "Example", "Notes"]);
  styleHeader(guide.getRow(1));
  const notes: Record<string, string> = {
    restaurant: "Exact restaurant name as in /restaurants",
    start: "YYYY-MM-DD, inclusive, Asia/Kuwait calendar",
    end: "YYYY-MM-DD, inclusive",
    targetType: "single or tiered (blank = tiered)",
    target: "Required for single. Deliveries that unlock the reward.",
    rewardType: "fixed or per_delivery (blank = fixed)",
    reward: "Required for single + fixed. 0.5 KD steps (1, 1.5, 2).",
    rate: "Required for single + per_delivery. 0.05 KD steps (0.25, 0.35, 0.5).",
    baseMinimum: "Deliveries below this never score (blank = 0)",
    tiers:
      "Required for tiered. threshold=amount or threshold:fixed:amount or threshold:per_delivery:amount; separate with ;",
    period: "daily, weekly or monthly (blank = daily)",
    priority: "Higher wins when two rules match (blank = scope default)",
    override: "yes/no — replaces stacked rule totals (blank = no)",
    status: "draft, active or ended (blank = active)",
    name: "Blank builds `Restaurant Start date`",
  };
  for (const column of INCENTIVE_IMPORT_COLUMNS) {
    guide.addRow([
      column.header,
      column.required ? "yes" : "no",
      column.example,
      notes[column.key] ?? "",
    ]);
  }
  guide.columns = [
    { width: 26 },
    { width: 10 },
    { width: 30 },
    { width: 76 },
  ];

  return wb.xlsx.writeBuffer();
}
