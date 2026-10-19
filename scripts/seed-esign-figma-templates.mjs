#!/usr/bin/env node
/**
 * Upsert the 8 Figma e-sign templates. Dry-run unless --confirm.
 * Project musallam-delivery-prod, named database "default". Never deletes.
 */
import { randomUUID } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const PROJECT = "musallam-delivery-prod";
const DATABASE = "default";
const RETIRED = new Set(["ytfmsgckjatiserpgdbz", "cgpioijpvriiqqnauwlx", "musallam-delivery-kw"]);
const CONFIRM = process.argv.includes("--confirm");

const DECLARATION_EN =
  "I acknowledge that the details above have been explained to me, and that I have received a copy of this document.";
const DECLARATION_AR =
  "أقر بأن التفاصيل أعلاه قد تم شرحها لي، وأنني استلمت نسخة من هذا المستند.";

const SYSTEM = [
  ["company_name", "Company", "الشركة"],
  ["employee_name", "Employee name", "اسم الموظف"],
  ["employee_id", "Employee ID", "رقم الموظف"],
];

const PAYSLIP_SYSTEM = [
  ["position", "Position", "المنصب"],
  ["sponsor", "Sponsor", "الكفيل"],
  ["pay_through", "Pay through", "يُصرف حتى"],
  ["bank_number", "Bank number", "رقم البنك"],
];

const PAYSLIP_SHEET = [
  ["date_from", "Date from", "من تاريخ", "date"],
  ["date_to", "Date to", "إلى تاريخ", "date"],
  ["computed_on", "Computed on", "احتُسب في", "date"],
  ["actual_days", "Actual days", "الأيام الفعلية", "number"],
  ["admin_deduction", "Admin deduction", "خصم الإدارة", "number"],
  ["extra_input", "Extra input", "إدخال إضافي", "number"],
  ["basic_salary", "Basic salary", "الراتب الأساسي", "number"],
  ["net_salary", "Net salary", "صافي الراتب", "number"],
];

const PENALTY_ACTION_OPTIONS = [
  "Written warning",
  "10% deduction of a day's salary",
  "25% deduction of a day's salary",
  "50% deduction of a day's salary",
  "One day deduction",
  "Two days deduction",
  "Three days deduction",
  "Four days deduction",
  "Five days deduction",
  "Dismissal final warning",
  "Others",
];

const PENALTY_SHEET = [
  ["penalty", "Penalty", "الجزاء", "number"],
  ["date_of_violation", "Date of violation", "تاريخ المخالفة", "date"],
  ["penalty_action", "Penalty action", "إجراء الجزاء", "select", PENALTY_ACTION_OPTIONS],
  ["others_amount", "Others amount", "مبلغ آخر", "number"],
  ["penalty_if_repeated", "Penalty if repeated", "الجزاء عند التكرار", "text"],
  ["remarks", "Remarks", "ملاحظات", "textarea"],
];

/** The four kinds the single Accident template serves. Labels live in i18n. */
const ACCIDENT_REQUEST_KINDS = ["accident", "sick_leave", "medical_report", "declaration"];

const LOAN_PAYMENT_METHODS = ["Cash", "Transaction", "Other"];
const LOAN_INSTALLMENTS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const LOAN_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const LOAN_SHEET = [
  ["payment_method", "Payment method", "طريقة الدفع", "select", LOAN_PAYMENT_METHODS],
  ["amount", "Requested amount", "المبلغ المطلوب", "number"],
  ["installments", "Installments", "الأقساط", "select", LOAN_INSTALLMENTS],
  ["loan_month", "Month", "الشهر", "select", LOAN_MONTHS],
  ["reason", "Reason", "السبب", "textarea"],
];

function systemFields(extra = []) {
  return [...SYSTEM, ...extra].map(([field_key, label_en, label_ar], index) =>
    field({
      field_key,
      label_en,
      label_ar,
      field_type: "text",
      source_kind: "system",
      section_key: "employee",
      sort_order: index + 1,
    }),
  );
}

function sheetFields(rows, start) {
  return rows.map(([field_key, label_en, label_ar, field_type, options], index) =>
    field({
      field_key,
      label_en,
      label_ar,
      field_type,
      source_kind: "entry",
      section_key: "document",
      sort_order: start + index,
      options: options ?? [],
    }),
  );
}

function signature(field_key, label_en, label_ar, sort_order) {
  return field({
    field_key,
    label_en,
    label_ar,
    field_type: "text",
    source_kind: "signature",
    section_key: "document",
    sort_order,
  });
}

function field(body) {
  return {
    options: [],
    is_required: false,
    options_source: null,
    preview_value: null,
    ...body,
  };
}

const EMPLOYEE_SIGNATURE = signature("employee_signature", "Employee Signature", "توقيع الموظف", 60);

const TEMPLATES = [
  createSpec({
    figma_key: "loan_request",
    sort_order: 1,
    bulk_mode: "sign_and_return",
    name_en: "Loan Request",
    name_ar: "طلب سلفه",
    category_key: "loan",
    document_kind: "loan",
    body_en: "Loan request",
    body_ar: "طلب سلفه",
    rename: false,
    aliases: [{ name_en: "Loan Request" }],
    fields: [
      ...systemFields(),
      ...sheetFields(LOAN_SHEET, 20),
      EMPLOYEE_SIGNATURE,
      signature("hr_signature", "HR", "الموارد البشرية", 70),
      signature("ceo_signature", "CEO", "الرئيس التنفيذي", 80),
    ],
  }),
  createSpec({
    figma_key: "payslip",
    sort_order: 2,
    bulk_mode: "sign_and_return",
    name_en: "Payslip",
    name_ar: "قسيمة الراتب",
    category_key: "payslip",
    document_kind: "payslip",
    body_en: "Payslip",
    body_ar: "قسيمة الراتب",
    rename: true,
    aliases: [{ name_en: "Salary Deduction Acknowledgement", document_kind: "payslip" }],
    fields: [
      ...systemFields(PAYSLIP_SYSTEM),
      ...sheetFields(PAYSLIP_SHEET, 20),
      EMPLOYEE_SIGNATURE,
    ],
  }),
  createSpec({
    figma_key: "asset",
    sort_order: 3,
    name_en: "Asset",
    name_ar: "عهدة",
    category_key: "asset",
    document_kind: "general",
    body_en: "Asset acknowledgement",
    body_ar: "إقرار عهدة",
  }),
  createSpec({
    figma_key: "leave",
    sort_order: 4,
    name_en: "Leave",
    name_ar: "إجازة",
    category_key: "leave",
    document_kind: "general",
    body_en: "Leave request",
    body_ar: "طلب إجازة",
  }),
  createSpec({
    figma_key: "penalty_notice",
    sort_order: 5,
    name_en: "Penalty Notice",
    name_ar: "إشعار جزاء",
    category_key: "penalty",
    document_kind: "penalty",
    body_en: "Penalty notice",
    body_ar: "إشعار جزاء",
    fields: [
      ...systemFields(),
      ...sheetFields(PENALTY_SHEET, 20),
      EMPLOYEE_SIGNATURE,
      signature("hr_admin_signature", "HR/Admin", "الموارد البشرية / الإدارة", 70),
      signature("general_manager_signature", "General Manager", "المدير العام", 80),
    ],
  }),
  createSpec({
    figma_key: "investigation",
    sort_order: 6,
    name_en: "Investigation",
    name_ar: "تحقيق",
    category_key: "investigation",
    document_kind: "general",
    body_en: "Investigation notice",
    body_ar: "إشعار تحقيق",
  }),
  createSpec({
    figma_key: "accident",
    sort_order: 7,
    name_en: "Accident",
    name_ar: "حادث",
    category_key: "accident",
    document_kind: "general",
    header_en: "Accident",
    header_ar: "حادث",
    body_en: "Accident report",
    body_ar: "تقرير حادث",
    fields: [
      ...systemFields(),
      ...sheetFields(
        [["request_kind", "Request kind", "نوع الطلب", "select", ACCIDENT_REQUEST_KINDS]],
        20,
      ),
      EMPLOYEE_SIGNATURE,
    ],
  }),
  createSpec({
    figma_key: "general_document",
    sort_order: 8,
    bulk_mode: "import",
    name_en: "General document",
    name_ar: "مستند عام",
    category_key: "general_doc",
    document_kind: "general",
    body_en: "General document",
    body_ar: "مستند عام",
    rename: true,
    aliases: [{ name_en: "General Acknowledgement" }],
    fields: [...systemFields(), EMPLOYEE_SIGNATURE],
  }),
];

function createSpec(spec) {
  return {
    bulk_mode: "import",
    rename: false,
    aliases: [],
    fields: [...systemFields(), EMPLOYEE_SIGNATURE],
    header_en: "MUSALLAM DELIVERY",
    header_ar: "مسلم للتوصيل",
    declaration_en: DECLARATION_EN,
    declaration_ar: DECLARATION_AR,
    ...spec,
  };
}

function same(left, right) {
  if (left === right) return true;
  if (left == null && right == null) return true;
  return false;
}

function matchTemplate(docs, spec, claimed) {
  const free = docs.filter((doc) => !claimed.has(doc.refId));
  const byKey = free.find((doc) => doc.data.figma_key === spec.figma_key);
  if (byKey) return { doc: byKey, via: "figma_key" };
  const byName = free
    .filter((doc) => doc.data.name_en === spec.name_en)
    .sort((a, b) => a.refId.localeCompare(b.refId));
  if (byName.length > 0) return { doc: byName[0], via: "name_en" };
  for (const alias of spec.aliases ?? []) {
    const hits = free
      .filter((doc) => {
        if (doc.data.name_en !== alias.name_en) return false;
        if (alias.document_kind && doc.data.document_kind !== alias.document_kind) return false;
        return true;
      })
      .sort((a, b) => a.refId.localeCompare(b.refId));
    if (hits.length > 0) return { doc: hits[0], via: "alias" };
  }
  return { doc: null, via: "create" };
}

function categoryLive(categories, key) {
  const byId = categories.find((doc) => doc.refId === key && doc.data.is_active === true);
  if (byId) return true;
  return categories.some((doc) => doc.data.key === key && doc.data.is_active === true);
}

async function loadAll(db, name) {
  const out = [];
  let cursor = null;
  for (;;) {
    let query = db.collection(name).orderBy("__name__").limit(300);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    if (snap.empty) break;
    for (const doc of snap.docs) out.push({ refId: doc.id, data: doc.data() });
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < 300) break;
  }
  return out;
}

function planOne(spec, match, fieldsByTemplate, categories) {
  const existingFields = match.doc ? fieldsByTemplate.get(match.doc.refId) ?? [] : [];
  const have = new Set(existingFields.map((fieldDoc) => fieldDoc.data.field_key));
  const fieldsCreate = spec.fields.filter((row) => !have.has(row.field_key)).map((row) => row.field_key);
  const fieldsSkip = spec.fields.filter((row) => have.has(row.field_key)).map((row) => row.field_key);

  if (!match.doc) {
    if (!spec.category_key || !categoryLive(categories, spec.category_key)) {
      return {
        figma_key: spec.figma_key,
        action: "blocked",
        reason: spec.category_key ? `category_missing:${spec.category_key}` : "no_match",
        fields_create: fieldsCreate,
      };
    }
    return {
      figma_key: spec.figma_key,
      action: "create",
      name_en: spec.name_en,
      name_ar: spec.name_ar,
      category_key: spec.category_key,
      document_kind: spec.document_kind,
      bulk_mode: spec.bulk_mode,
      sort_order: spec.sort_order,
      fields_create: fieldsCreate,
      fields_skip: fieldsSkip,
    };
  }

  const patch = {
    figma_key: spec.figma_key,
    bulk_mode: spec.bulk_mode,
    sort_order: spec.sort_order,
  };
  if (spec.category_key) {
    patch.category_key = spec.category_key;
    patch.is_active = true;
    patch.is_draft = false;
  }
  if (spec.document_kind) {
    patch.document_kind = spec.document_kind;
  }
  if (spec.rename) {
    patch.name_en = spec.name_en;
    patch.name_ar = spec.name_ar;
  }
  const templateChanges = Object.keys(patch).filter((key) => !same(match.doc.data[key], patch[key]));
  return {
    figma_key: spec.figma_key,
    action: templateChanges.length === 0 && fieldsCreate.length === 0 ? "noop" : "update",
    id: match.doc.refId,
    via: match.via,
    name_en_before: match.doc.data.name_en ?? null,
    name_en_after: spec.rename ? spec.name_en : match.doc.data.name_en ?? null,
    name_ar_after: spec.rename ? spec.name_ar : match.doc.data.name_ar ?? null,
    bulk_mode: spec.bulk_mode,
    sort_order: spec.sort_order,
    template_changes: templateChanges,
    fields_create: fieldsCreate,
    fields_skip: fieldsSkip,
  };
}

async function main() {
  const env = loadEnv();
  const account = loadServiceAccount(env);
  if (RETIRED.has(account.projectId) || account.projectId !== PROJECT) {
    throw new Error("refusing");
  }
  assertProd(account);

  const app =
    getApps()[0] ??
    initializeApp({
      credential: cert({
        projectId: account.projectId,
        clientEmail: account.clientEmail,
        privateKey: account.privateKey,
      }),
      projectId: PROJECT,
    });
  const db = getFirestore(app, DATABASE);

  const [templates, fieldDocs, categories, settingsSnap] = await Promise.all([
    loadAll(db, "esign_templates"),
    loadAll(db, "esign_template_fields"),
    loadAll(db, "esign_categories"),
    db.collection("app_settings").doc("1").get(),
  ]);
  const createdBy = settingsSnap.get("super_admin_user_id");
  const createdBySet = typeof createdBy === "string" && createdBy.trim() !== "";

  const fieldsByTemplate = new Map();
  for (const fieldDoc of fieldDocs) {
    const templateId = fieldDoc.data.template_id;
    if (typeof templateId !== "string") continue;
    const list = fieldsByTemplate.get(templateId) ?? [];
    list.push(fieldDoc);
    fieldsByTemplate.set(templateId, list);
  }

  const claimed = new Set();
  const plans = [];
  for (const spec of TEMPLATES) {
    const match = matchTemplate(templates, spec, claimed);
    if (match.doc) claimed.add(match.doc.refId);
    plans.push({ spec, match, plan: planOne(spec, match, fieldsByTemplate, categories) });
  }

  const blocked = plans.filter((row) => row.plan.action === "blocked");
  const report = {
    mode: CONFIRM ? "confirm" : "dry-run",
    project: PROJECT,
    database: DATABASE,
    writes: 0,
    templates: plans.map((row) => row.plan),
    untouched: templates
      .filter((doc) => !claimed.has(doc.refId))
      .map((doc) => ({ id: doc.refId, name_en: doc.data.name_en ?? null }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };

  if (!CONFIRM) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (blocked.length > 0) {
    console.log(JSON.stringify(report, null, 2));
    throw new Error("blocked");
  }

  let writes = 0;
  let batch = db.batch();
  const flush = async () => {
    if (writes % 400 === 0 && writes > 0) {
      await batch.commit();
      batch = db.batch();
    }
  };
  const queue = async (op) => {
    op(batch);
    writes += 1;
    if (writes % 400 === 0) await flush();
  };

  for (const row of plans) {
    if (row.plan.action === "noop") continue;
    const spec = row.spec;
    let templateId = row.match.doc?.refId ?? null;
    const templateRef = templateId
      ? db.collection("esign_templates").doc(templateId)
      : db.collection("esign_templates").doc(randomUUID());
    templateId = templateRef.id;

    if (row.plan.action === "create") {
      const body = {
        id: templateId,
        category_key: spec.category_key,
        name_en: spec.name_en,
        name_ar: spec.name_ar,
        header_en: spec.header_en,
        header_ar: spec.header_ar,
        body_en: spec.body_en,
        body_ar: spec.body_ar,
        declaration_en: spec.declaration_en,
        declaration_ar: spec.declaration_ar,
        default_language: "en",
        document_kind: spec.document_kind,
        is_active: true,
        is_draft: false,
        version: 1,
        figma_key: spec.figma_key,
        bulk_mode: spec.bulk_mode,
        sort_order: spec.sort_order,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      };
      if (createdBySet) body.created_by = createdBy;
      await queue((pending) => pending.set(templateRef, body));
    } else {
      const patch = {
        figma_key: spec.figma_key,
        bulk_mode: spec.bulk_mode,
        sort_order: spec.sort_order,
        updated_at: FieldValue.serverTimestamp(),
      };
      if (spec.category_key) {
        patch.category_key = spec.category_key;
        patch.is_active = true;
        patch.is_draft = false;
      }
      if (spec.document_kind) {
        patch.document_kind = spec.document_kind;
      }
      if (spec.rename) {
        patch.name_en = spec.name_en;
        patch.name_ar = spec.name_ar;
      }
      if (row.plan.template_changes.length > 0 || row.plan.fields_create.length > 0) {
        const version = Number(row.match.doc.data.version ?? 0);
        patch.version = Number.isFinite(version) ? version + 1 : 1;
      }
      await queue((pending) => pending.set(templateRef, patch, { merge: true }));
    }

    const existing = new Set(
      (fieldsByTemplate.get(row.match.doc?.refId ?? "") ?? []).map((fieldDoc) => fieldDoc.data.field_key),
    );
    for (const wanted of spec.fields) {
      if (existing.has(wanted.field_key)) continue;
      const fieldRef = db.collection("esign_template_fields").doc(randomUUID());
      await queue((pending) =>
        pending.set(fieldRef, {
          template_id: templateId,
          ...wanted,
          created_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        }),
      );
    }
    row.plan.id = templateId;
    row.plan.name_en = spec.rename || row.plan.action === "create" ? spec.name_en : row.plan.name_en_after;
  }

  if (writes % 400 !== 0) await batch.commit();
  report.writes = writes;
  report.templates = plans.map((row) => ({
    ...row.plan,
    id: row.plan.id,
    name_en: row.plan.name_en ?? row.plan.name_en_after ?? row.spec.name_en,
  }));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "failed";
  console.error(message);
  process.exit(1);
});
