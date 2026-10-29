/**
 * One-shot corrective patch for the Combined Payroll SOP review.
 *
 *   node scripts/apply-combined-payroll-fixes.mjs
 *
 * 1. Restores the shared `riderCols` labels the SOP renames only apply to
 *    Combined Payroll, so the Payroll / Attendance & Orders / Application
 *    Attendance sheets keep their own column names.
 * 2. Adds the Off Structure sentence the SOP asks the note above the table to
 *    carry.
 * 3. Renames the Columns menu copy to the SOP wording.
 *
 * Idempotent: it sets values instead of appending.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MESSAGES = join(process.cwd(), "src", "messages");
const LOCALES = ["en", "ar"];

/** Values taken from `git show HEAD:` — the pre-SOP shared labels. */
const ORIGINAL_RIDER_COLS = {
  totalDays: { en: "Total Days", ar: "إجمالي الأيام" },
  finalOrders: { en: "Final orders", ar: "الطلبات النهائية" },
  partner: { en: "Client Name", ar: "اسم العميل" },
  reduced3: { en: "3 h days", ar: "أيام 3 ساعات" },
  half: { en: "Half days", ar: "أنصاف الأيام" },
  absLh: { en: "Absent LH", ar: "غياب LH" },
  absLo: { en: "Absent LO", ar: "غياب LO" },
  absence: { en: "Absence", ar: "غياب" },
  efficiency: { en: "Efficiency%", ar: "الكفاءة٪" },
};

const BANNER = {
  en: "One table: MG ID · Driver ID · Name are pinned, the day block follows Status, and every column after it is yours to order. Required Hours = the project's daily hours (Americana 12 h, Keeta 10 h) × the counted days from the 1st up to today. A day whose cell holds something other than hours — OFF, Sick, Accident, Leave, Training, Vehicle issue — is not counted, which is how each rider's own 2–3 allowed OFF days (Off Structure) leave the calculation.",
  ar: "جدول واحد: MG ID · Driver ID · الاسم مثبّتة، وكتلة الأيام بعد الحالة، وترتيب بقية الأعمدة لك. الساعات المطلوبة = ساعات المشروع اليومية (أمريكانا 12 ساعة، كيتا 10 ساعات) × الأيام المحتسبة من الأول حتى اليوم. اليوم الذي تحتوي خليته على شيء غير الساعات — راحة، مرض، حادث، إجازة، تدريب، مشكلة مركبة — لا يُحتسب، وهكذا تخرج أيام الراحة المسموحة لكل راكب (هيكل الراحة) من الحساب.",
};

const DAILY_GROUP = {
  en: "Daily columns ({from} … {to})",
  ar: "الأعمدة اليومية ({from} … {to})",
};

for (const locale of LOCALES) {
  const file = join(MESSAGES, `${locale}.json`);
  const catalogue = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  const payroll = catalogue.pages.payroll;

  for (const [key, values] of Object.entries(ORIGINAL_RIDER_COLS)) {
    payroll.riderCols[key] = values[locale];
  }

  payroll.combinedBannerBody = BANNER[locale];
  payroll.combinedColumns = {
    ...payroll.combinedColumns,
    count: "{count}",
    dailyGroup: DAILY_GROUP[locale],
  };

  writeFileSync(file, `${JSON.stringify(catalogue, null, 2)}\n`, "utf8");
  console.log(`${locale}: patched`);
}
