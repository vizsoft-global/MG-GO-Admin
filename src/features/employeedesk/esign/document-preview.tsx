"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { resolveFieldSource } from "@/features/esign/template-source";
import { employeeSampleValues } from "@/features/esign/employee-block";
import { useBrandingOptional } from "@/contexts/branding-context";
import {
  buildEsignDocumentHtml,
  fitEsignSinglePage,
  sampleEmployee,
  type EsignRenderField,
} from "@/features/esign/render/esign-document-html";
import {
  defaultPenaltyActionOptions,
  isPenaltyActionFieldKey,
  PENALTY_VISIBLE_FIELD_KEY,
} from "@/features/esign/esign-penalty-checks";
import type { EsignDocumentKind, EsignTemplateFieldRow } from "@/features/esign/types";

/** CSS pixels of an A4 page at 96dpi, scaled to the 620px preview column. */
const A4_CSS_WIDTH = (595.28 * 96) / 72;
const A4_CSS_HEIGHT = (841.89 * 96) / 72;
const FIGMA_PREVIEW_SCALE = 620 / A4_CSS_WIDTH;

/**
 * Sample values for the system-filled rows.
 *
 * The preview has to show a reader what the *delivered* document looks like, and
 * a system field resolves from the rider's snapshot at send time — which does not
 * exist while an author is drafting. Showing an empty cell there would read as a
 * broken field, so each reserved key gets a plausible sample.
 *
 * The samples come from the same catalogue the block itself is built from
 * (`employee-block.ts`), so the preview cannot promise a row the PDF does not
 * print. A `system` field whose key is *not* in that catalogue shows `—` rather
 * than an invented value: nothing fills it, and a preview that hides that is
 * the one thing a preview must not do.
 */
const SYSTEM_SAMPLES = employeeSampleValues();

function sampleFor(field: EsignTemplateFieldRow): string {
  if (isPenaltyActionFieldKey(field.field_key)) return "";
  if (SYSTEM_SAMPLES[field.field_key]) return SYSTEM_SAMPLES[field.field_key];
  // A field's own saved sample outranks the type default. The reference draws a
  // *filled* payslip — `August 2026`, `26`, `260.000` — so a preview whose every
  // entry row is an em-dash cannot be held against it. This is preview-only
  // content on the field row, never a value the request or the PDF renderer sees.
  if (field.preview_value) return field.preview_value;
  const source = resolveFieldSource(field);
  if (source === "system") return "—";
  if (source === "fixed") return field.options[0] ?? "—";
  // No branch for `signature`: those rows are lifted out of the body and drawn
  // as signature slots, so a sample value for them would be a value nothing
  // renders. A `date` row that a person signs is still a date row.
  if (field.field_type === "date") return "— / — / ——";
  if (field.field_type === "select") return field.options[0] ?? "Select…";
  return "";
}

export type DocumentPreviewSigners = {
  employeeLabel: string;
  staffLabel: string;
};

/**
 * The A4 live preview beside the template builder and on send.
 *
 * This is a **document**, not a form: it is laid out the way the rendered PDF is
 * laid out, so an author sees the artefact they are building rather than a list
 * of the inputs that will produce it. Every outgoing kind — penalty, loan,
 * payslip, and general (asset / leave / investigation / accident / general_doc)
 * — renders the same bilingual HTML sheet the unsigned PDF uses.
 */
export function EsignDocumentPreview({
  templateName,
  nameAr,
  company,
  body,
  bodyAr,
  declaration,
  declarationAr,
  fields,
  values,
  documentKind,
  signers,
  fill = false,
  className,
}: {
  templateName: string;
  nameAr?: string | null;
  company: string;
  body: string;
  bodyAr?: string;
  declaration: string;
  declarationAr?: string;
  fields: EsignTemplateFieldRow[];
  values: Record<string, string>;
  documentKind: EsignDocumentKind;
  signers: DocumentPreviewSigners;
  /** Scale the A4 sheet to the parent box (Individual send left pane). */
  fill?: boolean;
  className?: string;
}) {
  const branding = useBrandingOptional();
  const resolvedBodyAr = bodyAr ?? "";
  const resolvedDeclarationAr = declarationAr ?? "";
  const resolvedBodyEn = body;
  const resolvedDeclarationEn = declaration;

  const sheetHtml = useMemo(() => {
    const employee = sampleEmployee({
      company_name: values.company_name?.trim() || company || "Musallam Delivery",
      employee_name: values.employee_name?.trim() || values.full_name?.trim() || "Ahmed Ali",
      employee_id: values.employee_id?.trim() || "10421",
      ...(values.civil_id?.trim() ? { civil_id: values.civil_id.trim() } : {}),
      ...(values.accommodation?.trim() ? { accommodation: values.accommodation.trim() } : {}),
      ...(values.joined_at?.trim() ? { joined_at: values.joined_at.trim() } : {}),
      ...(values.position?.trim()
        ? { position: values.position.trim(), project: values.position.trim() }
        : {}),
      ...(values.sponsor?.trim() ? { sponsor: values.sponsor.trim() } : {}),
      ...(values.pay_through?.trim() ? { pay_through: values.pay_through.trim() } : {}),
      ...(values.bank_number?.trim() ? { bank_number: values.bank_number.trim() } : {}),
    });
    return buildEsignDocumentHtml({
      language: "en",
      kind: documentKind,
      headerEn: templateName,
      headerAr: nameAr ?? "",
      bodyEn: resolvedBodyEn,
      bodyAr: resolvedBodyAr,
      declarationEn: resolvedDeclarationEn,
      declarationAr: resolvedDeclarationAr,
      company,
      logoUrl: branding?.logoUrl,
      fields: (() => {
        const mapped: EsignRenderField[] = fields.map((field) => ({
          key: field.field_key,
          label: field.label_en,
          labelEn: field.label_en,
          labelAr: field.label_ar || field.label_en,
          value:
            values[field.field_key]?.trim() ||
            (resolveFieldSource(field) === "signature" ? "" : sampleFor(field)),
          section: field.section_key === "employee" ? "employee" : "document",
          source: resolveFieldSource(field),
          ...(isPenaltyActionFieldKey(field.field_key)
            ? { options: defaultPenaltyActionOptions(field) }
            : {}),
        }));
        const visible = values[PENALTY_VISIBLE_FIELD_KEY]?.trim();
        if (visible) {
          mapped.push({
            key: PENALTY_VISIBLE_FIELD_KEY,
            label: "",
            labelEn: "",
            labelAr: "",
            value: visible,
            section: "document",
            source: "entry",
          });
        }
        const absenceSpecs = [
          { key: "absence_from", alias: "from_date", en: "From", ar: "من" },
          { key: "absence_to", alias: "to_date", en: "To", ar: "إلى" },
        ] as const;
        for (const spec of absenceSpecs) {
          const value = values[spec.key]?.trim() || values[spec.alias]?.trim();
          if (!value || mapped.some((field) => field.key === spec.key || field.key === spec.alias)) {
            continue;
          }
          mapped.push({
            key: spec.key,
            label: spec.en,
            labelEn: spec.en,
            labelAr: spec.ar,
            value,
            section: "document",
            source: "entry",
          });
        }
        return mapped;
      })(),
      employee,
      staffLabel: signers.staffLabel,
    });
  }, [
    branding?.logoUrl,
    company,
    declaration,
    declarationAr,
    documentKind,
    fields,
    nameAr,
    resolvedBodyAr,
    resolvedBodyEn,
    resolvedDeclarationAr,
    resolvedDeclarationEn,
    signers.staffLabel,
    templateName,
    values,
  ]);

  const fillRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!fill) return;
    const el = fillRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect;
      if (!next) return;
      setBox({ w: next.width, h: next.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fill]);

  const scale =
    fill && box.w > 0 && box.h > 0
      ? Math.min(box.w / A4_CSS_WIDTH, box.h / A4_CSS_HEIGHT)
      : FIGMA_PREVIEW_SCALE;

  return (
    <div
      ref={fillRef}
      className={cn(
        "relative w-full overflow-hidden",
        fill ? "h-full min-h-0 max-w-none" : "mx-auto max-w-[620px]",
        className,
      )}
      style={fill ? undefined : { height: A4_CSS_HEIGHT * FIGMA_PREVIEW_SCALE }}
    >
      <iframe
        title={templateName || "Document preview"}
        srcDoc={sheetHtml}
        className="pointer-events-none absolute start-0 top-0 border-0 bg-white"
        style={{
          width: A4_CSS_WIDTH,
          height: A4_CSS_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
        onLoad={(event) => {
          const doc = event.currentTarget.contentDocument;
          if (doc) fitEsignSinglePage(doc);
        }}
      />
    </div>
  );
}
