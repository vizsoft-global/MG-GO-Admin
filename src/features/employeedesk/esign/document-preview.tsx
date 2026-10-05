"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { FIELD_SOURCE_META, resolveFieldSource } from "@/features/esign/template-source";
import {
  ESIGN_EMPLOYEE_ROWS,
  employeeRowLabel,
  employeeSampleValues,
} from "@/features/esign/employee-block";
import type {
  EsignDocumentKind,
  EsignLocale,
  EsignTemplateFieldRow,
} from "@/features/esign/types";

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

/**
 * The payslip layout, declared as the reference draws it.
 *
 * Panel C2 does not print a payslip as an Item / Value list. It prints the month
 * block first, then the day counts, then the money — and each money row carries
 * the **column code the bulk sheet uses** (`BASIC`, `NET`, `All`, `Ded`) beside
 * its label, because the reader of a payslip is comparing the sheet against the
 * voucher and the code is what the two have in common. Without the codes the
 * screen shows the right numbers in the right order and still cannot be held
 * against the sheet a payroll clerk is reading.
 *
 * The `label` half of each row is *not* declared here: it is the field's own
 * `label_en` / `label_ar`, printed from the template. A hard-coded English label
 * would read as English inside an Arabic document, which is the one thing the
 * reference's Arabic subtitle exists to avoid.
 *
 * A key this template does not carry is skipped rather than printed blank: a
 * payslip whose author removed `Gross salary` must not grow an empty row back.
 */
const PAYSLIP_GROUPS = [
  { key: "month", fieldKeys: ["slip_month"] },
  { key: "period", fieldKeys: ["period_from", "period_to"] },
  { key: "computedOn", fieldKeys: ["computed_on"] },
  { key: "workingDays", fieldKeys: ["fixed_working_days", "actual_working_days"] },
  {
    key: "money",
    fieldKeys: [
      "gross_salary_kwd",
      "deduction_amount_kwd",
      "basic_salary_kwd",
      "extra_input_kwd",
      "net_salary_kwd",
      "rate_kwd",
      "amount",
    ],
  },
  { key: "reason", fieldKeys: ["deduction_reason"] },
] as const;

/**
 * Sheet column code per money row, exactly the four panel C2 prints.
 *
 * Only the four that appear on the reference's own sheet are mapped. It would be
 * easy to coin a fifth for `Gross salary` — and wrong: the example sheet's
 * columns are Employee ID, Date from, Date to, Computed on, Actual days,
 * Administration deduction, Extra input, Basic salary, Net salary, Civil ID, so a
 * `GROSS` chip would print a column code that no sheet the operator can download
 * actually has. A row with no code renders as a plain row instead.
 */
const PAYSLIP_COLUMN_CODES: Record<string, string> = {
  basic_salary_kwd: "BASIC",
  net_salary_kwd: "NET",
  extra_input_kwd: "All",
  deduction_amount_kwd: "Ded",
};

function sampleFor(field: EsignTemplateFieldRow): string {
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
 * The A4 live preview beside the template builder.
 *
 * This is a **document**, not a form: it is laid out the way the rendered PDF is
 * laid out, so an author sees the artefact they are building rather than a list
 * of the inputs that will produce it. Three regions come from the reference and
 * are fixed parts of the skeleton — the Employee Information grid, the dual
 * signature row and the Management Use Only box — because every penalty and loan
 * document carries them; only the middle section varies with `documentKind`.
 *
 * `dir` follows the template's own default language, not the panel locale: an
 * Arabic template prints Arabic with the grid reading right-to-left regardless of
 * which language the operator is using, and previewing it any other way would
 * hide exactly the bidi problems the preview exists to catch.
 */
export function EsignDocumentPreview({
  templateName,
  nameAr,
  company,
  body,
  declaration,
  fields,
  values,
  locale,
  documentKind,
  signers,
  className,
}: {
  templateName: string;
  nameAr?: string | null;
  company: string;
  body: string;
  declaration: string;
  fields: EsignTemplateFieldRow[];
  values: Record<string, string>;
  locale: EsignLocale;
  documentKind: EsignDocumentKind;
  signers: DocumentPreviewSigners;
  className?: string;
}) {
  const t = useTranslations("pages.employeedesk.esign.templateBuilder.preview");
  const dir = locale === "ar" ? "rtl" : "ltr";

  // Employee Information is its own two-column grid; everything else is the
  // document body. Splitting on the stored `section_key` is what lets the
  // reference's two-tab field list drop into one continuous page.
  const employeeFields = fields.filter((f) => f.section_key === "employee");
  const documentFields = fields.filter((f) => f.section_key !== "employee");

  /**
   * A row whose value is signed off by a person is not a line of body text — it
   * is a signature slot, and the reference draws every signature at the foot of
   * the page as a ruled block. Left in place, a "Signed by a person" row
   * rendered as a dotted body line carrying the sample value "Signed", which is
   * a preview claiming a signature nobody has given. So these are lifted out of
   * both sections and appended to the fixed employee/HR pair, where the extra
   * slots fill the second row of the same grid.
   */
  const isSignatureRow = (field: EsignTemplateFieldRow) =>
    resolveFieldSource(field) === "signature";
  const signatureFields = fields.filter(isSignatureRow);
  /**
   * The body rows proper — everything except the signature slots. The empty
   * state and the render both read this, or a template whose only document row
   * is a signature would paint a "no fields" placeholder above the signature
   * it does have.
   */
  const documentBodyFields = documentFields.filter((f) => !isSignatureRow(f));

  const valueOf = (field: EsignTemplateFieldRow) =>
    values[field.field_key]?.trim() || sampleFor(field);

  /**
   * The employee reference in the page footer.
   *
   * The label reads "MG HR Ref Emp." — an *employee* reference — so the value
   * beside it has to be the employee number. It was printing a truncated
   * template name, which is a different fact in the one place a reader goes to
   * match a printed sheet back to a person. An author-supplied `employee_id`
   * wins, so a template that pins one employee previews with that number; every
   * other template shows the sample its own Employee Information grid shows, so
   * the two places cannot disagree.
   */
  const employeeRef = values.employee_id?.trim() || SYSTEM_SAMPLES.employee_id || "—";

  /**
   * The payslip rows, in the reference's reading order.
   *
   * Built by walking `PAYSLIP_GROUPS` and keeping only the keys this template
   * actually carries, so a removed row stays removed and the flat list the panel
   * draws comes out in the panel's order. The label is the field's own, which is
   * what keeps an Arabic payslip Arabically labelled.
   */
  const payslipRows = documentKind === "payslip"
    ? PAYSLIP_GROUPS.flatMap((group) => group.fieldKeys)
        .map((key) => documentBodyFields.find((f) => f.field_key === key))
        .filter((field): field is EsignTemplateFieldRow => Boolean(field))
    : [];

  return (
    <div
      dir={dir}
      className={cn(
        // A4 proportions, not content height. The reference draws the pane as a
        // page, and an author needs it that way: the whole question the preview
        // answers is "does this fit an A4 sheet", and a box that shrinks to its
        // content cannot answer it. `min-h` rather than `aspect-[210/297]` so a
        // long field list grows the sheet instead of being clipped.
        "mx-auto flex w-full max-w-[620px] min-h-[877px] flex-col rounded-sm border border-border/70 bg-white text-[11px] leading-snug text-neutral-900 shadow-sm",
        className,
      )}
    >
      {/* Masthead — the company identity block that every document opens with. */}
      <header className="flex items-start justify-between gap-3 border-b-2 border-neutral-800 px-5 pb-3 pt-5">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid size-8 place-items-center rounded bg-neutral-900 text-[11px] font-bold text-white"
          >
            M
          </span>
          <div className="leading-tight">
            <p className="text-[12px] font-bold">{company || "—"}</p>
            <p className="text-[9px] uppercase tracking-wide text-neutral-500">
              {t("internalDocument")}
            </p>
          </div>
        </div>
        <div className="text-end leading-tight">
          <p className="text-[12px] font-bold">{templateName || t("untitled")}</p>
          {nameAr ? (
            <p className="text-[10px] text-neutral-600" dir="rtl">
              {nameAr}
            </p>
          ) : null}
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-4 px-5 py-4">
        {/* Employee Information — always present, always a two-column grid.
            The block's system rows come first, from the same catalogue the PDF
            renderer reads, so the grid shows the shape the rider will actually
            receive rather than only the rows this template happens to add. An
            author who adds nothing to this section still sees a populated
            block, which is what the reference draws and what the document
            prints. */}
        <section>
          <SectionTitle>{t("employeeInformation")}</SectionTitle>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {ESIGN_EMPLOYEE_ROWS.map((row) => (
              <PreviewRow
                key={row.key}
                label={employeeRowLabel(row, locale)}
                value={row.sample}
                muted
              />
            ))}
            {employeeFields.filter((f) => !isSignatureRow(f)).map((field) => (
              <PreviewRow
                key={field.id || field.field_key}
                label={locale === "ar" ? field.label_ar || field.label_en : field.label_en}
                value={valueOf(field)}
                muted={!values[field.field_key]?.trim()}
              />
            ))}
          </div>
        </section>

        {/* Document body — the kind-specific middle, which is where a penalty
            table and a loan breakdown genuinely differ. */}
        {body.trim() ? (
          <p className="whitespace-pre-line text-[10.5px] text-neutral-700">{body}</p>
        ) : null}

        <section>
          <SectionTitle>
            {documentKind === "penalty"
              ? t("penaltyDetails")
              : documentKind === "loan"
                ? t("loanDetails")
                : documentKind === "payslip"
                  ? t("payslipDetails")
                  : t("documentDetails")}
          </SectionTitle>
          {documentKind === "payslip" ? (
            /* Panel C2's shape: one flat ruled list, month → period → days →
               money → reason, with the bulk sheet's column code beside every
               money row. No sub-headings — the reference draws none, and adding
               them would put a heading on screen that the printed PDF lacks. */
            payslipRows.length === 0 ? (
              <p className="rounded border border-dashed border-neutral-300 px-2 py-3 text-center text-[10px] text-neutral-400">
                {t("noDocumentFields")}
              </p>
            ) : (
              <ul className="divide-y divide-neutral-200 rounded border border-neutral-200">
                {payslipRows.map((field) => {
                  const code = PAYSLIP_COLUMN_CODES[field.field_key];
                  return (
                    <li
                      key={field.id || field.field_key}
                      className="flex items-baseline justify-between gap-3 px-2.5 py-1.5"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        {code ? (
                          <span className="shrink-0 rounded border border-neutral-300 bg-neutral-100 px-1 py-px font-mono text-[8.5px] font-semibold uppercase tracking-wide text-neutral-600">
                            {code}
                          </span>
                        ) : null}
                        <span className="truncate text-neutral-700">
                          {locale === "ar" ? field.label_ar || field.label_en : field.label_en}
                        </span>
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">
                        {valueOf(field) || "—"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )
          ) : documentBodyFields.length === 0 ? (
            <p className="rounded border border-dashed border-neutral-300 px-2 py-3 text-center text-[10px] text-neutral-400">
              {t("noDocumentFields")}
            </p>
          ) : documentKind === "penalty" ? (
            <table className="w-full border-collapse text-[10.5px]">
              <thead>
                <tr className="bg-neutral-100 text-[9px] uppercase tracking-wide text-neutral-600">
                  <th className="border border-neutral-300 px-2 py-1 text-start font-semibold">
                    {t("columnItem")}
                  </th>
                  <th className="w-28 border border-neutral-300 px-2 py-1 text-start font-semibold">
                    {t("columnValue")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {documentBodyFields.map((field) => (
                  <tr key={field.id || field.field_key}>
                    <td className="border border-neutral-300 px-2 py-1">
                      {locale === "ar" ? field.label_ar || field.label_en : field.label_en}
                    </td>
                    <td className="border border-neutral-300 px-2 py-1 font-medium">
                      {valueOf(field) || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {documentBodyFields.map((field) => (
                <PreviewRow
                  key={field.id || field.field_key}
                  label={locale === "ar" ? field.label_ar || field.label_en : field.label_en}
                  value={valueOf(field)}
                  muted={!values[field.field_key]?.trim()}
                  source={resolveFieldSource(field)}
                />
              ))}
            </div>
          )}

          {/* The loan clause is part of the loan artefact, not of the skeleton:
              the reference prints it on a voucher and it would be nonsense on a
              penalty notice. It is a line to be completed on paper, so it is a
              ruled blank rather than a value. */}
          {documentKind === "loan" ? (
            <p className="mt-2 flex items-baseline gap-2 text-[10.5px]">
              <span className="shrink-0 text-neutral-700">{t("loanNotReceived")}</span>
              <span className="min-w-0 flex-1 border-b border-dotted border-neutral-400" />
            </p>
          ) : null}
        </section>

        {declaration.trim() ? (
          <p className="rounded border border-neutral-300 bg-neutral-50 px-3 py-2 text-[10px] leading-relaxed text-neutral-700">
            {declaration}
          </p>
        ) : null}
      </div>

      {/* Signatures — the fixed pair first, then any slot the author added.
          An employee document is signed by the employee and countersigned by
          HR; neither is an author choice, so neither is a field row. A row
          marked "Signed by a person" is a *third* kind of thing — an
          author-chosen signature — and it joins this same grid rather than
          getting a heading of its own, because a heading the reference does not
          have is a heading the printed PDF does not have either. */}
      <div className="grid grid-cols-2 gap-5 px-5 pb-3">
        <SignatureBlock label={signers.employeeLabel} t={t} />
        <SignatureBlock label={signers.staffLabel} t={t} />
        {signatureFields.map((field) => {
          const label =
            locale === "ar" ? field.label_ar || field.label_en : field.label_en;
          const entered = values[field.field_key]?.trim();
          return (
            <SignatureBlock
              key={field.id || field.field_key}
              label={label}
              t={t}
              // A signature slot an author typed a value into is the one case
              // where the value is worth printing: it is not a stroke, it is a
              // name or a date the document states.
              note={entered || undefined}
            />
          );
        })}
      </div>

      {/* Management Use Only — the box the reference draws for the decision.
          It is a *paper* box: the CEO ticks one of two options, HR and the
          General Manager sign it, and the outcome is written in. All three
          regions are fixed parts of the skeleton rather than author fields,
          because a template author must not be able to remove the place where
          the company records its own decision. */}
      <div className="mx-5 mb-3 rounded border border-neutral-300">
        <p className="border-b border-neutral-300 bg-neutral-100 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-neutral-600">
          {t("managementUseOnly")}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2 text-[10.5px]">
          <span className="font-semibold">{t("ceoDecision")}</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] border border-neutral-500" />
            {t("approved")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] border border-neutral-500" />
            {t("notApproved")}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-5 border-t border-dashed border-neutral-300 px-3 pb-2 pt-1.5">
          <SignatureBlock label={t("hrAdminDepartment")} t={t} className="pt-1.5" />
          <SignatureBlock label={t("generalManager")} t={t} className="pt-1.5" />
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-neutral-300 px-3 py-2">
          <BlankLine label={t("approvalStatus")} />
          <BlankLine label={t("decision")} />
        </div>
      </div>

      <footer className="flex items-center justify-between border-t border-neutral-300 px-5 py-2 text-[8.5px] text-neutral-400">
        <span>
          {t("refPrefix")} {employeeRef}
        </span>
        <span>{company || "—"}</span>
        <span>{t("pageOf", { page: 1, total: 1 })}</span>
      </footer>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 border-b border-neutral-300 pb-1 text-[9.5px] font-bold uppercase tracking-wide text-neutral-700">
      {children}
    </p>
  );
}

function PreviewRow({
  label,
  value,
  muted,
  source,
}: {
  label: string;
  value: string;
  muted?: boolean;
  source?: keyof typeof FIELD_SOURCE_META;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <span className="shrink-0 text-[9.5px] text-neutral-500">{label}</span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate border-b border-dotted border-neutral-300 pb-px",
          muted && "text-neutral-400",
          source === "fixed" && "font-semibold",
        )}
      >
        {value || "—"}
      </span>
    </div>
  );
}

function SignatureBlock({
  label,
  t,
  className,
  note,
}: {
  label: string;
  t: (key: string) => string;
  className?: string;
  note?: string;
}) {
  return (
    <div className={cn("pt-3", className)}>
      <div className="mb-1 h-6 border-b border-neutral-500" />
      <p className="text-[9px] font-semibold text-neutral-600">{label}</p>
      <p className="text-[8.5px] text-neutral-400">
        {note ?? t("signatureDate")}
      </p>
    </div>
  );
}

/** A ruled line for something written in by hand after the document is printed. */
function BlankLine({ label }: { label: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <span className="shrink-0 text-[9.5px] text-neutral-500">{label}</span>
      <span className="min-w-0 flex-1 border-b border-dotted border-neutral-400" />
    </div>
  );
}
