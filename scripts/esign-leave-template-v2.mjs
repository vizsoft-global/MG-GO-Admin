#!/usr/bin/env node
/**
 * Leave Request — retire the old template as **V1 (Draft)** and install the
 * client's own Leave Request as the live one.
 *
 * The client supplied `Leave_Request_employee.pdf`: a five-signature sheet with
 * a leave-type checklist, a period block, a manager block, an HR-only block and
 * their seven leave policies. That is a different document from the plain body
 * the old `leave` template printed, so the old row is kept, renamed and drafted
 * rather than overwritten — a signed document already frozen to it must still
 * point at something that explains what it was.
 *
 * **Dry-run unless --confirm.** Never deletes. Idempotent: a second run finds the
 * V1 row already drafted and the live row already installed, and writes nothing.
 *
 *   node scripts/esign-leave-template-v2.mjs            # preview
 *   node scripts/esign-leave-template-v2.mjs --confirm   # apply
 */
import { randomUUID } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const PROJECT = "musallam-delivery-prod";
const DATABASE = "default";
const RETIRED = new Set([
  "ytfmsgckjatiserpgdbz",
  "cgpioijpvriiqqnauwlx",
  "musallam-delivery-kw",
]);
const CONFIRM = process.argv.includes("--confirm");

const OLD_NAME_EN = "Leave (V1)";
const OLD_NAME_AR = "إجازة (نسخة 1)";
const NEW_NAME_EN = "Leave Request";
const NEW_NAME_AR = "طلب إجازة";
const NEW_FIGMA_KEY = "leave_request";

const LEAVE_TYPE_OPTIONS = [
  "Annual Leave",
  "Emergency Leave",
  "Unpaid Leave",
  "Sick Leave",
  "Maternity Leave",
  "Accident Leave",
];

/** Employee block, in the client's order: code, name, sponsor, civil ID, position. */
const EMPLOYEE_FIELDS = [
  ["employee_id", "Employee Code", "رقم الموظف", "text"],
  ["employee_name", "Employee Name", "اسم الموظف", "text"],
  ["sponsor", "Sponsor", "الكفيل", "text"],
  ["civil_id", "Civil ID Number", "الرقم المدني", "text"],
  ["position", "Position", "المهنة", "text"],
];

/** Everything the operator or HR fills in on the new sheet. */
const DOCUMENT_FIELDS = [
  ["leave_type", "Type of leave", "نوع الإجازة", "select", LEAVE_TYPE_OPTIONS],
  ["leave_from", "Starting date", "تاريخ بداية الإجازة", "date"],
  ["leave_to", "Ending date", "تاريخ الانتهاء", "date"],
  ["leave_days", "Number of days", "عدد الأيام", "number"],
  ["direct_manager", "Direct manager", "المدير المباشر", "text"],
  ["responsibility_assigned", "Responsibility assigned to", "المسؤول أثناء الغياب", "text"],
  ["manager_notes", "Direct manager notes", "ملاحظات المدير المباشر", "textarea"],
  ["date_of_employment", "Date of employment", "تاريخ التعيين", "date"],
  ["leave_balance", "Balance until the start of the leave", "الرصيد حتى بداية الإجازة", "number"],
  ["actual_leave_days", "Actual number of leave days", "عدد أيام الإجازة الفعلي", "number"],
  ["resume_date", "Resume date", "تاريخ المباشرة", "date"],
  ["hr_comments", "HR comments", "ملاحظات شؤون الموظفين", "textarea"],
];

/** One signature field per printed box. The compose step stamps each one. */
const SIGNATURE_FIELDS = [
  ["employee_signature", "Employee", "الموظف"],
  ["direct_manager_signature", "Direct Manager", "المدير المباشر"],
  ["hr_responsibility_signature", "HR Responsibility", "مسؤول الموارد البشرية"],
  ["hr_manager_signature", "HR Manager", "مدير الموارد البشرية"],
  ["general_manager_signature", "General Manager", "المدير العام"],
];

function field(body) {
  return {
    options: [],
    is_required: false,
    options_source: null,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
    ...body,
  };
}

function buildFields(templateId) {
  const rows = [];
  EMPLOYEE_FIELDS.forEach(([key, en, ar, type], index) => {
    rows.push(
      field({
        template_id: templateId,
        field_key: key,
        label_en: en,
        label_ar: ar,
        field_type: type,
        source_kind: "system",
        section_key: "employee",
        sort_order: index + 1,
      }),
    );
  });
  DOCUMENT_FIELDS.forEach(([key, en, ar, type, options], index) => {
    rows.push(
      field({
        template_id: templateId,
        field_key: key,
        label_en: en,
        label_ar: ar,
        field_type: type,
        source_kind: key === "date_of_employment" ? "system" : "entry",
        section_key: "document",
        sort_order: 20 + index,
        options: options ?? [],
      }),
    );
  });
  SIGNATURE_FIELDS.forEach(([key, en, ar], index) => {
    rows.push(
      field({
        template_id: templateId,
        field_key: key,
        label_en: en,
        label_ar: ar,
        field_type: "text",
        source_kind: "signature",
        section_key: "document",
        sort_order: 60 + index,
      }),
    );
  });
  return rows;
}

function templateBody(id, categoryKey) {
  return {
    id,
    category_key: categoryKey,
    name_en: NEW_NAME_EN,
    name_ar: NEW_NAME_AR,
    header_en: NEW_NAME_EN,
    header_ar: NEW_NAME_AR,
    body_en: "",
    body_ar: "",
    declaration_en: "",
    declaration_ar: "",
    default_language: "en",
    document_kind: "leave",
    is_active: true,
    is_draft: false,
    version: 2,
    figma_key: NEW_FIGMA_KEY,
    bulk_mode: null,
    sort_order: 45,
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

  const [templatesSnap, fieldsSnap, categoriesSnap] = await Promise.all([
    db.collection("esign_templates").get(),
    db.collection("esign_template_fields").get(),
    db.collection("esign_categories").get(),
  ]);

  const templates = templatesSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  const categoryKeys = new Set(
    categoriesSnap.docs.map((doc) => String(doc.get("key") ?? doc.id)).filter(Boolean),
  );
  const leaveCategory = categoryKeys.has("leave")
    ? "leave"
    : String(categoriesSnap.docs[0]?.get("key") ?? "leave");

  // A live leave template is either the new figma key or any row already on the
  // `leave` document kind.
  const live = templates.find(
    (row) => row.data.figma_key === NEW_FIGMA_KEY || row.data.document_kind === "leave",
  );
  const legacy = templates.filter((row) => {
    if (live && row.id === live.id) return false;
    return (
      row.data.figma_key === "leave" ||
      row.data.category_key === "leave" ||
      /^leave$/i.test(String(row.data.name_en ?? "").trim())
    );
  });

  const fieldCounts = new Map();
  for (const doc of fieldsSnap.docs) {
    const templateId = doc.get("template_id");
    if (typeof templateId !== "string") continue;
    fieldCounts.set(templateId, (fieldCounts.get(templateId) ?? 0) + 1);
  }

  const report = {
    mode: CONFIRM ? "confirm" : "dry-run",
    project: PROJECT,
    live: live
      ? {
          id: live.id,
          name_en: live.data.name_en ?? null,
          document_kind: live.data.document_kind ?? null,
          fields: fieldCounts.get(live.id) ?? 0,
          action: "noop",
        }
      : { action: "create", name_en: NEW_NAME_EN, fields: buildFields("").length },
    demote: legacy.map((row) => ({
      id: row.id,
      name_en: row.data.name_en ?? null,
      is_draft: row.data.is_draft === true,
      action:
        row.data.is_draft === true && row.data.name_en === OLD_NAME_EN ? "noop" : "demote",
    })),
  };

  if (!CONFIRM) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  let batch = db.batch();
  let writes = 0;
  const commit = async () => {
    if (writes === 0) return;
    await batch.commit();
    batch = db.batch();
    writes = 0;
  };

  for (const row of legacy) {
    if (row.data.is_draft === true && row.data.name_en === OLD_NAME_EN) continue;
    batch.set(
      db.collection("esign_templates").doc(row.id),
      {
        name_en: OLD_NAME_EN,
        name_ar: OLD_NAME_AR,
        is_draft: true,
        is_active: false,
        retired_at: FieldValue.serverTimestamp(),
        retired_reason: "Replaced by Leave Request",
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    writes += 1;
    if (writes >= 400) await commit();
  }
  await commit();

  if (!live) {
    const templateId = randomUUID();
    batch.set(db.collection("esign_templates").doc(templateId), {
      ...templateBody(templateId, leaveCategory),
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
    writes += 1;
    for (const row of buildFields(templateId)) {
      batch.set(db.collection("esign_template_fields").doc(randomUUID()), row);
      writes += 1;
      if (writes >= 400) await commit();
    }
    await commit();
    report.live = { id: templateId, action: "created", fields: buildFields("").length };
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
