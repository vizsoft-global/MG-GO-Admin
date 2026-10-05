/**
 * Throwaway visual-QA harness for the eSign template builder preview.
 *
 * The builder page is behind the dashboard auth gate, so it cannot be opened in
 * a clean browser profile. This renders the two things that actually have to
 * agree — the React live preview and the server/PDF HTML — to static files that
 * can be screenshotted beside the reference PDF.
 *
 * `npx tsx scripts/esign-visual-qa.tsx <outDir>`
 */
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { EsignDocumentPreview } from "@/features/employeedesk/esign/document-preview";
import { buildEsignDocumentHtml, sampleEmployee } from "@/features/esign/render/esign-document-html";
import type {
  EsignFieldSection,
  EsignTemplateFieldRow,
  EsignTemplateFieldType,
} from "@/features/esign/types";

const messagesByLocale = {
  en: JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/messages/en.json"), "utf8")),
  ar: JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/messages/ar.json"), "utf8")),
};

/**
 * The app's compiled Tailwind, inlined. The QA server sends `.css` as
 * `application/octet-stream`, which a browser refuses to apply, so a link tag
 * would leave every utility class inert and the layout meaningless.
 */
const appCss = (() => {
  const file = process.argv[3];
  return file && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
})();

function field(
  id: string,
  key: string,
  labelEn: string,
  labelAr: string,
  type: EsignTemplateFieldType,
  section: EsignFieldSection,
  options: string[] = [],
): EsignTemplateFieldRow {
  return {
    id,
    template_id: "tpl",
    field_key: key,
    label_en: labelEn,
    label_ar: labelAr,
    field_type: type,
    options,
    is_required: true,
    sort_order: 0,
    source_kind: "entry",
    section_key: section,
    options_source: null,
    preview_value: null,
  };
}

const penaltyFields: EsignTemplateFieldRow[] = [
  field("f1", "penalty_type", "Penalty details", "تفاصيل الجزاء", "select", "document", [
    "10% deduction of a day's salary",
    "Two days deduction",
    "Three days deduction",
    "Four days deduction",
    "Five days deduction",
    "Dismissal final warning",
    "others",
  ]),
  field("f2", "violation_date", "Date of violation", "تاريخ المخالفة", "date", "document"),
  field("f3", "penalty_action", "Penalty action", "الإجراء", "text", "document"),
  field("f4", "repeated_penalty", "Penalty if repeated", "الجزاء عند التكرار", "text", "document"),
  field("f5", "remarks", "Remarks", "ملاحظات", "textarea", "document"),
];

const values: Record<string, string> = {
  penalty_type: "Two days deduction",
  violation_date: "2026-04-18",
  penalty_action: "Written warning",
  repeated_penalty: "Dismissal",
  remarks: "Left the assigned zone before shift end.",
};

function previewHtml(locale: "en" | "ar"): string {
  const markup = renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={messagesByLocale[locale]}
      timeZone="Asia/Kuwait"
    >
      <EsignDocumentPreview
        templateName="Penalty Notice"
        nameAr="إشعار جزاء"
        company="Musallam Delivery"
        body=""
        declaration="I acknowledge receipt of this notice and understand the penalty recorded above."
        fields={penaltyFields}
        values={values}
        locale={locale}
        documentKind="penalty"
        signers={{ employeeLabel: "Employee signature", staffLabel: "HR signature" }}
      />
    </NextIntlClientProvider>,
  );
  return wrap(locale, "Live preview (React)", markup);
}

function pdfHtml(locale: "en" | "ar"): string {
  const markup = buildEsignDocumentHtml({
    language: locale,
    header: "Penalty Notice",
    body: "",
    declaration:
      "I acknowledge receipt of this notice and understand the penalty recorded above.",
    description: "",
    fields: penaltyFields.map((f) => ({
      key: f.field_key,
      label: (locale === "ar" ? f.label_ar : f.label_en) ?? f.field_key,
      value: values[f.field_key] ?? "",
      section: "document" as const,
    })),
    employee: sampleEmployee(),
  });
  // The renderer emits a full document; lift the body so both panes sit in one page.
  const inner = /<body>([\s\S]*)<\/body>/.exec(markup)?.[1] ?? "";
  const css = /<style>([\s\S]*?)<\/style>/.exec(markup)?.[1] ?? "";
  return wrap(locale, "Rendered PDF HTML (server)", inner, css);
}

function wrap(
  locale: "en" | "ar",
  title: string,
  body: string,
  css = "",
): string {
  return `<!DOCTYPE html>
<html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8"/>
<title>${title}</title>
<style>${appCss}</style>
<style>
  body { margin: 0; padding: 28px; background: #eef0f3; font-family: "Segoe UI", Tahoma, sans-serif; }
  .pane-title { font: 700 13px/1.4 "Segoe UI", sans-serif; text-transform: uppercase;
    letter-spacing: .06em; color: #4b5563; margin: 0 0 12px; }
  .sheet { width: 595pt; min-height: 842pt; background: #fff; padding: 36pt;
    box-sizing: border-box; box-shadow: 0 1px 6px rgba(15,23,42,.14); margin-inline: auto; }
  ${css}
</style>
</head>
<body><p class="pane-title">${title}</p><div class="sheet">${body}</div></body>
</html>`;
}

const outDir = process.argv[2] ?? path.join(process.cwd(), ".qa-render");
fs.mkdirSync(outDir, { recursive: true });
for (const locale of ["en", "ar"] as const) {
  fs.writeFileSync(path.join(outDir, `preview-${locale}.html`), previewHtml(locale));
  fs.writeFileSync(path.join(outDir, `pdf-${locale}.html`), pdfHtml(locale));
}
console.log(`wrote 4 files to ${outDir}`);
