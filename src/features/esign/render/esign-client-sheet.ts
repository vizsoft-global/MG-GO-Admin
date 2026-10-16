import {
  documentSignRole,
  payslipSignRole,
  type BilingualText,
  type EsignDocumentLayout,
  type LayoutCheckbox,
  type LayoutFieldRow,
  type LayoutSection,
  type PayslipLine,
  type SignSlotRole,
} from "./esign-document-layout";
import type { EsignDocumentKind } from "../types";
import { ESIGN_FORMS_CSS } from "./esign-forms-css";
import { escapeHtml } from "./esign-placeholders";

const WARNING_KEYS = ["written_warning", "dismissal_warning"];
const PERCENT_KEYS = ["deduct_10", "deduct_25", "deduct_50"];
const DAY_KEYS = ["deduct_1_day", "deduct_2_day", "deduct_3_day", "deduct_4_day", "deduct_5_day"];

const NOTE_KEYS = new Set(["opening", "declaration", "appendix"]);
const SKIP_KEYS = new Set(["author_signs", "payslip_signs", "management"]);

function filled(rows: LayoutFieldRow[]): LayoutFieldRow[] {
  return rows.filter((row) => {
    if (row.source === "signature") return false;
    const value = row.value.trim();
    return value.length > 0 && value !== "—";
  });
}

function ar(text: string): string {
  return `<span class="ar" dir="rtl">${escapeHtml(text)}</span>`;
}

function secHead(index: number, title: BilingualText): string {
  const n = String(index).padStart(2, "0");
  return `<div class="sec"><span class="k">${n}</span><span>${escapeHtml(title.en)}</span>${ar(title.ar)}</div>`;
}

function labelCell(label: BilingualText): string {
  return `<td class="lab"><div class="row"><span>${escapeHtml(label.en)}</span>${ar(label.ar)}</div></td>`;
}

function gridTable(rows: LayoutFieldRow[]): string {
  const visible = filled(rows);
  if (visible.length === 0) return "";
  const body: string[] = [];
  for (let i = 0; i < visible.length; i += 2) {
    const left = visible[i];
    const right = visible[i + 1];
    if (!left) continue;
    if (!right) {
      body.push(`<tr>${labelCell(left.label)}<td class="val" colspan="3">${escapeHtml(left.value)}</td></tr>`);
      continue;
    }
    body.push(
      `<tr>${labelCell(left.label)}<td class="val">${escapeHtml(left.value)}</td>${labelCell(right.label)}<td class="val">${escapeHtml(right.value)}</td></tr>`,
    );
  }
  return `<table class="grid"><colgroup><col class="c-lab"/><col class="c-val"/><col class="c-lab"/><col class="c-val"/></colgroup><tbody>${body.join("")}</tbody></table>`;
}

function checkCell(check: LayoutCheckbox): string {
  const on = check.checked ? " on" : "";
  const selected = check.checked ? " is-selected" : "";
  const note = check.note?.trim() ? ` <span class="muted">${escapeHtml(check.note)}</span>` : "";
  return `<td class="opt${selected}"><div class="inner"><span class="cb${on}" data-check-key="${escapeHtml(check.key)}"></span><div><div class="en">${escapeHtml(check.label.en)}${note}</div><div class="ar ar-start" dir="rtl">${escapeHtml(check.label.ar)}</div></div></div></td>`;
}

function checkGroup(titleEn: string, titleAr: string, checks: LayoutCheckbox[]): string {
  if (checks.length === 0) return "";
  const cells = checks.map(checkCell).join("");
  return `<table class="opt-table"><tr><td class="lab grp"><div class="en">${escapeHtml(titleEn)}</div><div class="ar ar-start" dir="rtl">${escapeHtml(titleAr)}</div></td>${cells}</tr></table>`;
}

function penaltyChecks(checks: LayoutCheckbox[]): string {
  const byKey = new Map(checks.map((check) => [check.key, check]));
  const take = (keys: string[]) => keys.flatMap((key) => {
    const hit = byKey.get(key);
    return hit ? [hit] : [];
  });
  const known = new Set([...WARNING_KEYS, ...PERCENT_KEYS, ...DAY_KEYS]);
  const rest = checks.filter((check) => !known.has(check.key));
  return [
    checkGroup("Warnings", "الإنذارات", take(WARNING_KEYS)),
    checkGroup("Deduction — % of one day's salary", "خصم نسبة من مرتب يوم", take(PERCENT_KEYS)),
    checkGroup("Deduction — full days", "خصم أيام كاملة", take(DAY_KEYS)),
    checkGroup("Others", "أخرى", rest),
  ].join("");
}

function noteBlock(section: LayoutSection): string {
  const bits: string[] = [];
  if (section.title.en.trim() || section.title.ar.trim()) {
    bits.push(`<div><b>${escapeHtml(section.title.en)}</b> ${ar(section.title.ar)}</div>`);
  }
  const en = section.body?.en.trim() ?? "";
  const arText = section.body?.ar.trim() ?? "";
  if (en) bits.push(`<div>${escapeHtml(en)}</div>`);
  if (arText && arText !== en) bits.push(`<div class="ar ar-start" dir="rtl">${escapeHtml(arText)}</div>`);
  for (const row of filled(section.rows)) {
    bits.push(`<div><b>${escapeHtml(row.label.en)}</b> ${escapeHtml(row.value)}</div>`);
  }
  if (!en && !arText && filled(section.rows).length === 0) return "";
  return `<div class="note" data-section="${escapeHtml(section.key)}">${bits.join("")}</div>`;
}

function declarationNote(layout: EsignDocumentLayout): string {
  if (layout.sections.some((section) => section.key === "declaration")) return "";
  const en = layout.declaration.en.trim();
  const arText = layout.declaration.ar.trim();
  if (!en && !arText) return "";
  return noteBlock({
    key: "declaration",
    title: { en: "Declaration", ar: "الإقرار" },
    rows: [],
    body: layout.declaration,
  });
}

function findRow(layout: EsignDocumentLayout, keys: string[]): string {
  const pools = [layout.employeeRows, ...layout.sections.map((section) => section.rows)];
  for (const rows of pools) {
    for (const row of rows) {
      if (keys.includes(row.key) && row.value.trim() && row.value.trim() !== "—") return row.value.trim();
    }
  }
  return "";
}

function loanSchedule(layout: EsignDocumentLayout): string {
  const amount = Number(findRow(layout, ["amount", "requested_amount", "loan_amount"]).replace(/[^\d.]/g, ""));
  const months = Number(findRow(layout, ["period", "instalments_period", "installments_period", "tenure"]).replace(/[^\d.]/g, ""));
  const count = Number.isFinite(months) && months > 0 ? Math.min(6, Math.round(months)) : 0;
  const each = count > 0 && Number.isFinite(amount) ? amount / count : Number.NaN;
  const heads = Array.from({ length: 6 }, (_, i) => `<th>${i + 1}</th>`).join("");
  const cells = Array.from({ length: 6 }, (_, i) => {
    const value = i < count && Number.isFinite(each) ? each.toFixed(3) : "";
    return `<td class="num">${value}</td>`;
  }).join("");
  return `<div class="box schedule"><div class="sec"><span class="k">—</span><span>Repayment schedule</span>${ar("جدول السداد")}</div><table><tr>${heads}</tr><tr>${cells}</tr></table></div>`;
}

function payslipLine(line: PayslipLine | null): string {
  if (!line) return "<tr><td></td><td></td><td class=\"num\"></td><td class=\"num\"></td></tr>";
  return `<tr data-payslip-line="${escapeHtml(line.key)}" data-tone="${escapeHtml(line.tone)}"><td class="val code">${escapeHtml(line.code)}</td><td class="val">${escapeHtml(line.name.en)}<span class="sub ar ar-start" dir="rtl">${escapeHtml(line.name.ar)}</span></td><td class="num muted">${escapeHtml(line.rate)}</td><td class="val num">${escapeHtml(line.amount)}</td></tr>`;
}

function padLines(lines: PayslipLine[]): (PayslipLine | null)[] {
  const out: (PayslipLine | null)[] = [...lines];
  while (out.length < 4) out.push(null);
  return out;
}

function payslipTables(lines: PayslipLine[]): string {
  const earnings = padLines(lines.filter((line) => line.tone !== "net" && !line.key.includes("deduct")));
  const deductions = padLines(lines.filter((line) => line.key.includes("deduct")));
  const net = lines.find((line) => line.tone === "net");
  const head = `<tr><th>Code</th><th>Description ${ar("البيان")}</th><th class="num">Qty</th><th class="num">KD</th></tr>`;
  const table = (rows: (PayslipLine | null)[], totalLabel: string, totalAr: string, total: string) =>
    `<table class="lines-table"><colgroup><col class="c-code"/><col/><col class="c-qty"/><col class="c-amt"/></colgroup>${head}${rows.map(payslipLine).join("")}<tr><td colspan="3" class="lab lab--strong"><div class="row"><span>${totalLabel}</span>${ar(totalAr)}</div></td><td class="val num total-cell">${escapeHtml(total)}</td></tr></table>`;
  const earnTotal = "";
  const deductTotal = deductions.find((line) => line)?.amount ?? "";
  return `<div class="two-col" data-payslip="sheet"><div class="box"><div class="sec"><span class="k">03</span><span>Earnings</span>${ar("الاستحقاقات")}</div>${table(earnings, "Total Earnings", "إجمالي الاستحقاقات", earnTotal)}</div><div class="box"><div class="sec"><span class="k">04</span><span>Deductions</span>${ar("الخصومات")}</div>${table(deductions, "Total Deductions", "إجمالي الخصومات", deductTotal)}</div></div><div class="box net" data-tone="net" data-payslip-line="${escapeHtml(net?.key ?? "net_salary_kwd")}"><div class="words"><div class="t"><span>Net Salary</span>${ar("صافي الراتب")}</div><div class="en">${escapeHtml(net?.name.en ?? "Net Salary")}</div></div><div class="amount"><small>AMOUNT PAYABLE · KD</small><strong>${escapeHtml(net?.amount ?? "—")}</strong></div></div>`;
}

function defaultCaption(role: SignSlotRole, kind: EsignDocumentKind): BilingualText {
  if (kind === "payslip" && role === "hr") {
    return { en: "Authorised Signatory", ar: "المفوض بالتوقيع" };
  }
  switch (role) {
    case "employee":
      return { en: "Employee Signature", ar: "توقيع الموظف" };
    case "hr":
      return { en: "HR / Admin Department", ar: "إدارة الموارد البشرية / الإدارة" };
    case "gm":
      return { en: "General Manager", ar: "المدير العام" };
    case "ceo":
      return { en: "CEO Decision", ar: "قرار الرئيس التنفيذي" };
    case "ack_received":
      return { en: "Amount received", ar: "تم الاستلام" };
    case "ack_not_received":
      return { en: "Amount not received", ar: "لم يُستلم" };
    default: {
      const exhaustive: never = role;
      return exhaustive;
    }
  }
}

function captionFor(layout: EsignDocumentLayout, role: SignSlotRole): BilingualText {
  const rows = layout.sections
    .filter((section) => section.key === "author_signs" || section.key === "payslip_signs")
    .flatMap((section) => section.rows);
  const match = rows.find((row) => {
    if (layout.kind === "payslip") return payslipSignRole(row.key, row.label.en) === role;
    return documentSignRole(row.key, row.label.en) === role;
  });
  if (match && (match.label.en.trim() || match.label.ar.trim())) return match.label;
  return defaultCaption(role, layout.kind);
}

function nameLine(value: string): string {
  return `<div class="ln"><span>Name · ${ar("الاسم")}</span><i>${escapeHtml(value)}</i></div>`;
}

function signLine(role: SignSlotRole, label: BilingualText): string {
  const en = label.en.trim() || "Signature";
  const arText = label.ar.trim() || "التوقيع";
  return `<div class="ln tall"><span>${escapeHtml(en)} · ${ar(arText)}</span><i data-slot-role="${escapeHtml(role)}"></i></div>`;
}

function dateLine(): string {
  return `<div class="ln"><span>Date · ${ar("التاريخ")}</span><i></i></div>`;
}

function sigCard(title: BilingualText, role: SignSlotRole, name: string, stamp: boolean): string {
  const seal = stamp ? `<div class="stamp">Stamp<br/>${ar("الختم")}</div>` : "";
  return `<div class="sig sig--bare"><div class="h"><span>${escapeHtml(title.en)}</span>${ar(title.ar)}</div><div class="b"><div class="lines">${nameLine(name)}${signLine(role, { en: "Signature", ar: "التوقيع" })}${dateLine()}</div>${seal}</div></div>`;
}

function pairSig(title: BilingualText, role: SignSlotRole, name: string): string {
  return `<div class="sig"><div class="h"><span>${escapeHtml(title.en)}</span>${ar(title.ar)}</div><div class="b"><div class="lines">${nameLine(name)}${signLine(role, title)}${dateLine()}</div></div></div>`;
}

function signatures(layout: EsignDocumentLayout, staffLabel?: string): string {
  const roles = new Set(layout.slots.map((slot) => slot.role));
  const staff = staffLabel?.trim() ?? "";
  const employeeCaption = captionFor(layout, "employee");
  const hrCaption = captionFor(layout, "hr");
  if (layout.kind === "payslip") {
    const employee = roles.has("employee") ? pairSig(employeeCaption, "employee", findRow(layout, ["employee_name"])) : "";
    const hr = roles.has("hr") ? pairSig(hrCaption, "hr", staff) : "";
    return `<div class="sigs sigs--2" data-signature-band="1">${employee}${hr}</div>`;
  }
  const parts: string[] = [];
  if (roles.has("employee")) {
    parts.push(
      `<div class="box ack" data-signature-band="1"><div class="text"><b>Employee acknowledgement.</b> I confirm I have received and read this document.<div class="ar ar-start" dir="rtl">أقر باستلام هذا المستند والاطلاع عليه.</div></div><div class="sign"><div class="sig"><div class="b"><div class="lines">${signLine("employee", employeeCaption)}${dateLine()}</div></div></div></div></div>`,
    );
  }
  const management: string[] = [];
  if (roles.has("hr")) management.push(sigCard(hrCaption, "hr", staff, false));
  if (roles.has("gm")) management.push(sigCard(captionFor(layout, "gm"), "gm", "", true));
  if (roles.has("ceo")) management.push(sigCard(captionFor(layout, "ceo"), "ceo", "", true));
  if (management.length > 0) {
    const cols = management.length >= 3 ? "sigs--3" : "sigs--2";
    parts.push(
      `<div class="box" data-management="1"><div class="sec"><span class="k">04</span><span>Management Use Only</span>${ar("للاستخدام الإداري فقط")}</div><div class="sigs ${cols} sigs--joined mgmt-signs">${management.join("")}</div></div>`,
    );
  }
  for (const slot of layout.slots) {
    if (slot.role !== "ack_received" && slot.role !== "ack_not_received") continue;
    const title = captionFor(layout, slot.role);
    parts.push(
      `<div class="box ack"><div class="text"><b>${escapeHtml(title.en)}</b><div class="ar ar-start" dir="rtl">${escapeHtml(title.ar)}</div></div><div class="sign"><div class="sig"><div class="b"><div class="lines">${signLine(slot.role, title)}</div></div></div></div></div>`,
    );
  }
  return parts.join("");
}

function metaCell(en: string, ar: string, value: string): string {
  return `<td><div class="l"><span>${escapeHtml(en)}</span><span class="ar" dir="rtl">${escapeHtml(ar)}</span></div><div class="v">${value}</div></td>`;
}

function docNo(kind: EsignDocumentKind): BilingualText {
  switch (kind) {
    case "payslip":
      return { en: "Slip No.", ar: "رقم القسيمة" };
    case "loan":
      return { en: "Request No.", ar: "رقم الطلب" };
    case "penalty":
      return { en: "Notice No.", ar: "رقم الإشعار" };
    case "general":
      return { en: "Document No.", ar: "رقم المستند" };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function metaStrip(layout: EsignDocumentLayout): string {
  const ref = escapeHtml(layout.masthead.ref || "—");
  const date = escapeHtml(layout.masthead.date || "—");
  const department = escapeHtml(findRow(layout, ["zone", "department", "project"]) || "—");
  const status = `<span class="chip chip--wait">Awaiting signature</span>`;
  const no = docNo(layout.kind);
  if (layout.kind === "payslip") {
    return `<div class="box box--flush meta"><table><tr>${metaCell("Pay Period", "فترة الراتب", date)}${metaCell(no.en, no.ar, ref)}${metaCell("Computed On", "تاريخ الاحتساب", date)}${metaCell("Status", "الحالة", status)}</tr></table></div>`;
  }
  return `<div class="box box--flush meta"><table><tr>${metaCell(no.en, no.ar, ref)}${metaCell("Issue Date", "تاريخ الإصدار", date)}${metaCell("Department", "القسم", department)}${metaCell("Status", "الحالة", status)}</tr></table></div>`;
}

function sectionBox(section: LayoutSection, index: number): string {
  const rows = gridTable(section.rows);
  const checks = section.checkboxes?.length ? penaltyChecks(section.checkboxes) : "";
  const bodyEn = section.body?.en.trim() ?? "";
  const bodyAr = section.body?.ar.trim() ?? "";
  const body =
    bodyEn || bodyAr
      ? `<div class="note" data-section="${escapeHtml(section.key)}">${bodyEn ? `<div>${escapeHtml(bodyEn)}</div>` : ""}${bodyAr && bodyAr !== bodyEn ? `<div class="ar ar-start">${escapeHtml(bodyAr)}</div>` : ""}</div>`
      : "";
  if (!rows && !checks && !body) return "";
  const employee = section.key === "employee" ? ` class="employee-block" data-employee-block="1"` : ` class="box"`;
  const tag = section.key === "employee" ? "section" : "div";
  return `<${tag}${employee} data-section="${escapeHtml(section.key)}">${secHead(index, section.title)}${rows}${checks}${body}</${tag}>`;
}

function footer(layout: EsignDocumentLayout): string {
  const ref = escapeHtml(layout.masthead.ref || "—");
  const date = escapeHtml(layout.masthead.date || "");
  const footClass = layout.kind === "payslip" ? "doc-footer payslip-page-foot" : "doc-footer";
  return `<div class="${footClass}" data-sheet-foot="1"><div class="grow"><b>Generated by MGGO DPD</b> · ${date} · Form Ref: ${ref}<br/>Confidential — intended for the named employee and authorised HR staff only. <span class="ar" dir="rtl">سري — للموظف المعني والموارد البشرية فقط</span></div><div class="ref"><b>${ref}</b><br/>Page 1 of 1</div></div>`;
}

function employeeFromRows(rows: LayoutFieldRow[], index: number): string {
  const table = gridTable(rows);
  if (!table) return "";
  return `<section class="employee-block" data-employee-block="1" data-section="employee">${secHead(index, { en: "Employee Information", ar: "بيانات الموظف" })}${table}</section>`;
}

function payslipIdentity(layout: EsignDocumentLayout): string {
  const rows = layout.payslip?.identity ?? [];
  const visible = rows.filter((row) => row.value.trim() && row.value.trim() !== "—");
  const asRows: LayoutFieldRow[] = visible.map((row) => ({
    key: row.key,
    label: row.label,
    value: row.value,
    source: "system",
  }));
  return `<section class="employee-block" data-employee-block="1" data-payslip="identity" data-section="employee">${secHead(1, { en: "Employee Information", ar: "بيانات الموظف" })}${gridTable(asRows)}</section>`;
}

/**
 * Client HR sheet (penalty, loan, salary slip, and every other kind).
 * No company logo. `logoUrl` is ignored on purpose.
 */
export function renderClientSheetHtml(
  layout: EsignDocumentLayout,
  fontCss?: string,
  staffLabel?: string,
): string {
  let boxIndex = 1;
  const blocks: string[] = [];
  const hasEmployee = layout.sections.some((section) => section.key === "employee");
  if (layout.kind === "payslip") {
    blocks.push(payslipIdentity(layout));
    boxIndex = 2;
  } else if (!hasEmployee) {
    const block = employeeFromRows(layout.employeeRows, boxIndex);
    if (block) {
      blocks.push(block);
      boxIndex += 1;
    }
  }
  for (const section of layout.sections) {
    if (SKIP_KEYS.has(section.key)) continue;
    if (section.key === "payslip" && layout.payslip) {
      blocks.push(payslipTables(layout.payslip.lines));
      continue;
    }
    if (NOTE_KEYS.has(section.key) && !(section.checkboxes?.length)) {
      const note = noteBlock(section);
      if (note) blocks.push(note);
      continue;
    }
    if (section.key === "employee" && layout.kind === "payslip") continue;
    const box = sectionBox(section, boxIndex);
    if (!box) continue;
    blocks.push(box);
    boxIndex += 1;
    if (layout.kind === "loan" && section.key === "loan") blocks.push(loanSchedule(layout));
  }
  const titleEn = escapeHtml(layout.title.en);
  const titleAr = escapeHtml(layout.title.ar);
  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8"/>
<style>
${fontCss ?? ""}
${ESIGN_FORMS_CSS}
</style>
</head>
<body>
<div class="page" data-single-page="1">
<div class="page-fit">
<header class="doc-header"><div class="en">${titleEn}</div><div class="ar" dir="rtl">${titleAr}</div></header>
<div class="doc-rule"></div>
${metaStrip(layout)}
${blocks.join("")}
${declarationNote(layout)}
</div>
<div class="sheet-dock">
${signatures(layout, staffLabel)}
${footer(layout)}
</div>
</div>
</body>
</html>`;
}
