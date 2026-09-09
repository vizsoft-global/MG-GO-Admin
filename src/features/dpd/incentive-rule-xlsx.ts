import ExcelJS from "exceljs";
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

export async function buildIncentiveRulesWorkbook(
  rules: IncentiveRuleRow[],
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "DPD Admin";

  const sheet = wb.addWorksheet("Incentive rules");
  sheet.addRow([
    "Name",
    "Restaurant",
    "Period",
    "Start",
    "End",
    "Status",
    "Tiers",
    "Reward",
  ]);
  styleHeader(sheet.getRow(1));
  for (const rule of rules) {
    sheet.addRow([
      rule.name,
      rule.scope_label,
      rule.period,
      rule.start_date,
      rule.end_date,
      rule.status,
      formatTiers(rule),
      rule.reward_mode === "per_delivery"
        ? `${rule.reward_per_delivery_kwd ?? 0}/del`
        : rule.reward_kwd,
    ]);
  }
  sheet.columns = [
    { width: 28 },
    { width: 22 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 10 },
    { width: 28 },
    { width: 12 },
  ];

  const guide = wb.addWorksheet("Guide");
  guide.addRow(["Column", "Required", "Notes"]);
  styleHeader(guide.getRow(1));
  for (const row of [
    ["Restaurant", "yes", "Exact restaurant name as in /restaurants"],
    ["Start", "yes", "YYYY-MM-DD, inclusive, Asia/Kuwait calendar"],
    ["End", "yes", "YYYY-MM-DD, inclusive"],
    ["Tiers", "yes", "threshold=amount or threshold:fixed:amount or threshold:per_delivery:amount; separate with ;"],
  ]) {
    guide.addRow(row);
  }
  guide.columns = [{ width: 16 }, { width: 10 }, { width: 72 }];

  return wb.xlsx.writeBuffer();
}
