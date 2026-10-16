"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Building2, ChevronLeft, FileClock, FileText, Loader2, PencilLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchSelect } from "@/components/ui/search-select";
import { Textarea } from "@/components/ui/textarea";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { LAYOUT } from "@/components/app/layout-spacing";
import { cn } from "@/lib/utils";
import { driverSearchOptions } from "@/lib/search-options";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { EsignDocumentPreview } from "@/features/employeedesk/esign/document-preview";
import { isEsignDueDateAllowed } from "./esign-due-date";
import { addEsignSigner } from "./esign-signer-actions";
import { EsignSignersEditor, type EsignDraftStaffSigner } from "./esign-signers-editor";
import { previewStaffLabel } from "./esign-signers";
import { classifyEsignResolveError, mappedEsignErrorKey } from "./esign-resolve-error";
import { mergeFieldValuesForSend } from "./esign-snapshot-merge";
import {
  defaultPenaltyActionOptions,
  isPenaltyActionFieldKey,
  parsePenaltyVisible,
  penaltyControlFieldValues,
  resolvePenaltyCheckCatalogue,
  selectedKeysFromPenaltyValues,
} from "./esign-penalty-checks";
import {
  ABSENCE_FROM_KEYS,
  ABSENCE_TO_KEYS,
  withAbsenceDateFields,
} from "./esign-absence-fields";
import {
  isPenaltyHubQuery,
  isSendableHubTemplate,
  pickSendableHubTemplate,
  selectOptionsForField,
  templatesForHubCategory,
} from "./outgoing-hub-categories";
import { deleteEsignDraft, fetchEsignSnapshot, saveEsignDraft } from "./esign-sender-actions";
import {
  useCreateEsignFromTemplate,
  useEsignDriverOptions,
  useEsignDraft,
  useEsignTemplate,
  useEsignTemplates,
} from "./use-esign";
import { maskBankNumber } from "./render/esign-document-layout";
import {
  snapshotValues,
  type EsignEmployeeSnapshot,
} from "./render/esign-placeholders";
import type { EsignTemplateFieldRow } from "./types";

const SNAPSHOT_FIELD_KEYS = new Set([
  "company_name",
  "employee_name",
  "employee_id",
  "civil_id",
  "position",
  "sponsor",
  "pay_through",
  "bank_number",
]);

function shown(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed || "—";
}

function isSheetInput(field: EsignTemplateFieldRow): boolean {
  if (SNAPSHOT_FIELD_KEYS.has(field.field_key)) return false;
  switch (field.source_kind) {
    case "system":
    case "signature":
      return false;
    case "entry":
    case "fixed":
      return true;
    default: {
      const exhaustive: never = field.source_kind;
      return exhaustive;
    }
  }
}

const PAYSLIP_PERIOD_ORDER = [
  "slip_month",
  "period_from",
  "period_to",
  "computed_on",
  "fixed_working_days",
  "actual_working_days",
] as const;

const PAYSLIP_MONEY_CODES: Record<string, string> = {
  basic_salary_kwd: "BASIC",
  net_salary_kwd: "NET",
  extra_input_kwd: "All",
  deduction_amount_kwd: "Ded",
};

const PAYSLIP_KD_KEYS = new Set([
  "admin_deduction",
  "extra_input",
  "basic_salary",
  "net_salary",
  "basic_salary_kwd",
  "net_salary_kwd",
  "extra_input_kwd",
  "deduction_amount_kwd",
]);

function partitionPayslipFields(fields: EsignTemplateFieldRow[]) {
  const periodKeys = new Set<string>(PAYSLIP_PERIOD_ORDER);
  const moneyKeys = new Set(Object.keys(PAYSLIP_MONEY_CODES));
  const byKey = new Map(fields.map((field) => [field.field_key, field]));
  const period: EsignTemplateFieldRow[] = [];
  for (const key of PAYSLIP_PERIOD_ORDER) {
    const field = byKey.get(key);
    if (field) period.push(field);
  }
  const money: EsignTemplateFieldRow[] = [];
  const rest: EsignTemplateFieldRow[] = [];
  for (const field of fields) {
    if (periodKeys.has(field.field_key)) continue;
    if (moneyKeys.has(field.field_key)) money.push(field);
    else rest.push(field);
  }
  return { period, money, rest };
}

function previewFieldValues(
  fields: EsignTemplateFieldRow[],
  values: Record<string, string>,
  snapshot: EsignEmployeeSnapshot | null,
) {
  const next = snapshot ? snapshotValues(snapshot) : {};
  for (const field of fields) {
    const typed = values[field.field_key]?.trim();
    if (typed) next[field.field_key] = typed;
    else if (field.preview_value?.trim()) next[field.field_key] = field.preview_value;
  }
  return next;
}

export function EsignSendShell({
  /**
   * A template chosen upstream — the V2 builder's "Send for e-signature" passes
   * the template the author is looking at, so the send screen opens on that
   * document instead of making them find it again in the picker.
   *
   * It arrives as a prop rather than being read from `useSearchParams` in here,
   * because the page component is already handed the query string and a hook in
   * a client child would need a Suspense boundary it does not otherwise need.
   */
  initialTemplateId,
  /**
   * `?draft=<id>` — the drafts list resumes a saved single send by navigating
   * back here with the draft id. The composer rehydrates from the payload rather
   * than from a route param per field, because a draft carries the per-field
   * values and a URL long enough to hold them is not a URL anyone can share.
   */
  initialDraftId,
  initialCategoryKey,
  initialDriverId,
  initialResentFromId,
}: {
  initialTemplateId?: string;
  initialDraftId?: string;
  initialCategoryKey?: string;
  initialDriverId?: string;
  initialResentFromId?: string;
}) {
  const t = useTranslations("pages.requests.esign.send");
  const tHub = useTranslations("pages.requests.esign.hub");
  const tRcm = useTranslations("pages.rcmV2");
  const tBuilder = useTranslations("pages.employeedesk.esign.templateBuilder");
  const router = useRouter();
  const pathname = usePathname();
  const isV2 = pathname.includes("/employeedesk");
  const { data: templatesData } = useEsignTemplates();
  const { data: driversData } = useEsignDriverOptions();
  const create = useCreateEsignFromTemplate();

  const templates = useMemo(
    () => (templatesData?.rows ?? []).filter(isSendableHubTemplate),
    [templatesData?.rows],
  );
  const categoryTemplates = useMemo(() => {
    if (!initialCategoryKey) return templates;
    return templatesForHubCategory(templates, initialCategoryKey);
  }, [initialCategoryKey, templates]);
  const [templateId, setTemplateId] = useState<string | null>(initialTemplateId ?? null);
  const [categorySeeded, setCategorySeeded] = useState(false);
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);
  const [hiddenCheckKeys, setHiddenCheckKeys] = useState<string[]>([]);
  const [selectedCheckKeys, setSelectedCheckKeys] = useState<string[]>([]);
  const penaltyRestoredRef = useRef(false);
  useEffect(() => {
    if (categorySeeded || templateId || !initialCategoryKey) return;
    const picked = pickSendableHubTemplate(templatesData?.rows ?? [], initialCategoryKey);
    if (picked) {
      setTemplateId(picked.id);
      setCategorySeeded(true);
      return;
    }
    if (templatesData) setCategorySeeded(true);
  }, [categorySeeded, initialCategoryKey, templateId, templatesData]);
  useEffect(() => {
    setHiddenKeys([]);
    setHiddenCheckKeys([]);
    setSelectedCheckKeys([]);
    penaltyRestoredRef.current = false;
  }, [templateId]);
  const { data: templateData } = useEsignTemplate(templateId ?? "");
  const template = templateData?.template;

  const [driverId, setDriverId] = useState<string | null>(initialDriverId ?? null);
  const [snapshot, setSnapshot] = useState<EsignEmployeeSnapshot | null>(null);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [description, setDescription] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [sentResult, setSentResult] = useState<{ id: string; code: string } | null>(null);
  const [fullOpen, setFullOpen] = useState(false);

  /**
   * The draft this composer is editing, if any. Held as state rather than read
   * from the prop so the first "Save draft" turns a fresh send into a draft and
   * every later save updates that same row instead of piling up copies.
   */
  const [draftId, setDraftId] = useState<string | null>(initialDraftId ?? null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [staffSigners, setStaffSigners] = useState<EsignDraftStaffSigner[]>([]);
  const [pickedStaffName, setPickedStaffName] = useState("");
  const draftQuery = useEsignDraft(initialDraftId ?? "");
  /**
   * One-shot. A draft payload is the *starting* state, so it may only be
   * applied once: re-applying it on every refetch would silently undo whatever
   * the operator has typed since, which is exactly the work the draft exists to
   * protect. Same reason the template default effect below defers to it.
   */
  const draftAppliedRef = useRef(false);

  const isPayslip = template?.document_kind === "payslip";
  const isPenalty = template?.document_kind === "penalty";
  const payslipGroups = useMemo(
    () => (template ? partitionPayslipFields(template.fields) : null),
    [template],
  );
  const penaltyCatalogue = useMemo(() => {
    if (!isPenalty || !template) return [];
    const action = template.fields.find((field) => isPenaltyActionFieldKey(field.field_key));
    return resolvePenaltyCheckCatalogue({
      fields: [
        {
          key: action?.field_key ?? "penalty_action",
          options: defaultPenaltyActionOptions({
            field_key: action?.field_key ?? "penalty_action",
            options: action?.options,
          }),
        },
      ],
    });
  }, [isPenalty, template]);
  const penaltyValues = useMemo(
    () =>
      isPenalty ? penaltyControlFieldValues(penaltyCatalogue, selectedCheckKeys, hiddenCheckKeys) : {},
    [hiddenCheckKeys, isPenalty, penaltyCatalogue, selectedCheckKeys],
  );
  const previewValues = useMemo(() => {
    if (!template) return {};
    return { ...previewFieldValues(template.fields, values, snapshot), ...values, ...penaltyValues };
  }, [penaltyValues, snapshot, template, values]);
  const sheetFields = useMemo(() => {
    if (!template) return [];
    const source = payslipGroups
      ? [...payslipGroups.period, ...payslipGroups.money, ...payslipGroups.rest]
      : template.fields;
    const ordered = isPenalty ? withAbsenceDateFields(source, template.id) : source;
    return ordered.filter(
      (field) =>
        isSheetInput(field) &&
        !hiddenKeys.includes(field.field_key) &&
        !isPenaltyActionFieldKey(field.field_key),
    );
  }, [isPenalty, payslipGroups, template, hiddenKeys]);
  const resolvedTitle = title.trim() || template?.name_en || "";

  const hubHref = isV2 ? "/employeedesk" : "/requests/esign";
  const templatesHref = isV2 ? "/employeedesk/esign/templates" : "/requests/esign/templates";
  const bulkHref = templateId
    ? `${isV2 ? "/employeedesk/esign/bulk" : "/requests/esign/bulk"}?template=${templateId}`
    : isV2
      ? "/employeedesk/esign/bulk"
      : "/requests/esign/bulk";
  const editHref = templateId
    ? isV2
      ? `/employeedesk/esign/templates/${templateId}/edit`
      : `/requests/esign/templates/${templateId}`
    : templatesHref;
  const draftsHref = "/requests/esign/drafts";

  const driverItems = useMemo(
    () =>
      driverSearchOptions(
        (driversData?.rows ?? []).map((d) => ({
          id: d.id,
          full_name: d.full_name,
          driver_code: d.driver_code,
          employee_id: d.employee_id,
        })),
      ),
    [driversData?.rows],
  );
  const templateItems = useMemo(
    () =>
      (initialCategoryKey ? categoryTemplates : templates).map((row) => ({
        value: row.id,
        label: row.name_en,
        hint: row.category_key,
        keywords: [row.name_en, row.name_ar, row.category_key, row.id].filter(Boolean) as string[],
      })),
    [categoryTemplates, initialCategoryKey, templates],
  );

  useEffect(() => {
    const draft = draftQuery.data?.draft;
    if (!draft || draftAppliedRef.current) return;
    draftAppliedRef.current = true;
    if (draft.template_id) setTemplateId(draft.template_id);
    if (draft.title) setTitle(draft.title);
    if (draft.due_at) setDueAt(draft.due_at.slice(0, 10));
    if (draft.description) setDescription(draft.description);
    setValues(draft.field_values);
    const firstRow = draft.rows[0];
    if (firstRow?.driver_id) setDriverId(firstRow.driver_id);
  }, [draftQuery.data?.draft]);

  useEffect(() => {
    if (!draftAppliedRef.current || penaltyRestoredRef.current) return;
    if (!penaltyCatalogue.length) return;
    penaltyRestoredRef.current = true;
    const visible = parsePenaltyVisible(values.penalty_visible);
    if (visible) {
      setHiddenCheckKeys(
        penaltyCatalogue.filter((check) => !visible.includes(check.key)).map((check) => check.key),
      );
    }
    setSelectedCheckKeys(selectedKeysFromPenaltyValues(penaltyCatalogue, values));
  }, [penaltyCatalogue, values.penalty_action, values.penalty_type, values.penalty_visible]);

  useEffect(() => {
    if (!template) return;
    // A resumed draft is authoritative: its title, language and field values are
    // what the operator last saw, and re-seeding them from the template would
    // quietly replace that with the template's own defaults.
    if (draftAppliedRef.current) return;
    setTitle((prev) => prev || template.name_en);
    setValues((prev) => {
      const next = { ...prev };
      for (const field of template.fields) {
        if (next[field.field_key] == null) next[field.field_key] = "";
      }
      return next;
    });
  }, [template]);

  useEffect(() => {
    if (!driverId) {
      setSnapshot(null);
      return;
    }
    void fetchEsignSnapshot(driverId).then((result) => {
      if (!result.snapshot) {
        setSnapshot(null);
        const code = classifyEsignResolveError(result.error ?? "unknown_id");
        const mapped = mappedEsignErrorKey(code === "failed" ? "unknown_id" : code);
        if (mapped) toast.error(t(`errors.${mapped}`));
        return;
      }
      setSnapshot(result.snapshot);
      setValues((prev) =>
        mergeFieldValuesForSend(snapshotValues(result.snapshot!), prev, template?.fields ?? []),
      );
    });
  }, [driverId, t, template?.fields]);

  async function submit() {
    if (!driverId || !templateId || !resolvedTitle) {
      toast.error(t("errors.missingFields"));
      return;
    }
    if (!isEsignDueDateAllowed(dueAt, kuwaitTodayYmd())) {
      toast.error(t("errors.due_in_past"));
      return;
    }
    const result = await create.mutateAsync({
      driver_id: driverId,
      template_id: templateId,
      title: resolvedTitle,
      locale: "en",
      due_at: dueAt || null,
      description: description.trim() || null,
      field_values: { ...values, ...penaltyValues },
      resent_from_id: initialResentFromId ?? null,
    });
    if (!result.ok) {
      const mapped = mappedEsignErrorKey(result.error);
      toast.error(mapped ? t(`errors.${mapped}`) : (result.error ?? t("errors.createFailed")));
      return;
    }
    if (result.id) {
      for (const signer of staffSigners) {
        const added = await addEsignSigner({
          request_id: result.id,
          staff_user_id: signer.staff_user_id,
          role: signer.role,
          display_name: signer.display_name,
        });
        if (!added.ok) toast.error(added.error ?? t("errors.createFailed"));
      }
    }
    if (draftId) {
      const consumed = await deleteEsignDraft(draftId);
      if (!consumed.ok) toast.error(consumed.error ?? t("errors.draftFailed"));
    }
    if (result.id) {
      toast.success(t("sentToast", { count: 1 }));
      setSentResult({ id: result.id, code: result.request_code ?? "" });
      return;
    }
    router.push(isV2 ? "/employeedesk" : "/requests/esign");
  }

  /**
   * Save the composer as it stands.
   *
   * Only two things are required to save — a template and a title — and
   * deliberately not a driver: the value of a draft is that a half-built send
   * survives a reload, and the driver is frequently the last thing an operator
   * picks after filling the fields they had to look up. Requiring one here would
   * keep the draft feature from saving exactly the state it exists for.
   */
  async function saveDraft() {
    if (!templateId) {
      toast.error(t("errors.draftTemplate"));
      return;
    }
    setSavingDraft(true);
    const driver = (driversData?.rows ?? []).find((row) => row.id === driverId);
    const result = await saveEsignDraft({
      id: draftId,
      kind: "single",
      template_id: templateId,
      template_version: template?.version ?? null,
      language: "en",
      title: title.trim() || template?.name_en || null,
      due_at: dueAt || null,
      description: description.trim() || null,
      field_values: { ...values, ...penaltyValues },
      rows: driverId
        ? [
            {
              employee_id: driver?.employee_id ?? snapshot?.employee_id ?? "",
              driver_id: driverId,
            },
          ]
        : [],
    });
    setSavingDraft(false);
    if (!result.ok) {
      toast.error(result.error ?? t("errors.draftFailed"));
      return;
    }
    setDraftId(result.id ?? draftId);
    toast.success(t("draftSaved"));
  }

  function fieldInputPlaceholder(field: EsignTemplateFieldRow): string {
    const key = field.field_key;
    if (
      key === "violation_date" ||
      key === "penalty_date" ||
      key === "date_of_violation"
    ) {
      return t("placeholders.violationDate");
    }
    if (
      (ABSENCE_FROM_KEYS as readonly string[]).includes(key) ||
      key === "from_date"
    ) {
      return t("fieldAbsenceFrom");
    }
    if ((ABSENCE_TO_KEYS as readonly string[]).includes(key) || key === "to_date") {
      return t("fieldAbsenceTo");
    }
    const category = template?.category_key ?? "";
    if (isPenalty || isPenaltyHubQuery(category)) return t("placeholders.penalty");
    if (category === "investigation") return t("placeholders.investigation");
    return t("placeholders.generic");
  }

  function renderField(field: EsignTemplateFieldRow, code?: string) {
    const options = selectOptionsForField(field, template?.category_key ?? "");
    const placeholder = fieldInputPlaceholder(field);
    return (
      <div key={field.id} className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Label className="flex items-center gap-1.5">
            <span>
              {field.label_en}
              {isPayslip && PAYSLIP_KD_KEYS.has(field.field_key) && !field.label_en.includes("(KD)")
                ? " (KD)"
                : ""}
              {field.is_required ? <span className="text-destructive"> *</span> : null}
            </span>
            {code ? (
              <span className="rounded border border-border bg-muted/50 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {code}
              </span>
            ) : null}
          </Label>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-destructive hover:bg-destructive/10"
            onClick={() => setHiddenKeys((prev) => [...prev, field.field_key])}
          >
            <Trash2 className="size-3" aria-hidden />
            {t("hideField")}
          </button>
        </div>
        {field.field_type === "select" && options.length > 0 ? (
          options.length > 30 ? (
            <SearchSelect
              items={options.map((option) => ({
                value: option,
                label: option,
                keywords: [option],
              }))}
              value={values[field.field_key] || null}
              onChange={(next) =>
                setValues((prev) => ({ ...prev, [field.field_key]: next ?? "" }))
              }
              placeholder={t("fieldSelectPlaceholder")}
              searchPlaceholder={t("fieldSelectSearch")}
              recentsKey={`esign-send-select-${field.field_key}`}
              className="w-full"
            />
          ) : (
            <Select
              value={values[field.field_key] || undefined}
              onValueChange={(next) =>
                setValues((prev) => ({ ...prev, [field.field_key]: next ?? "" }))
              }
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder={t("fieldSelectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        ) : field.field_type === "textarea" ? (
          <Textarea
            className="min-h-16"
            value={values[field.field_key] ?? ""}
            placeholder={placeholder}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, [field.field_key]: e.target.value }))
            }
          />
        ) : (
          <Input
            className="h-9"
            type={field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"}
            value={values[field.field_key] ?? ""}
            placeholder={placeholder}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, [field.field_key]: e.target.value }))
            }
          />
        )}
      </div>
    );
  }

  const breadcrumbs = isV2
    ? [
        { label: tRcm("outgoing"), href: "/employeedesk" },
        { label: t("title") },
      ]
    : [
        { label: tHub("requests"), href: "/employeedesk" },
        { label: tHub("title"), href: "/requests/esign" },
        { label: t("title") },
      ];

  if (sentResult) {
    const sentDate = kuwaitTodayYmd();
    const batchHref = isV2 ? "/employeedesk/esign/batches" : "/requests/esign/batches";
    const requestHref = `/requests/esign/${sentResult.id}`;
    return (
      <AppPage>
        <AppPageHeader
          title={title || template?.name_en || t("title")}
          description={
            <span>
              {tRcm("batchEmployees", { count: 1, date: sentDate })}
              {template?.name_en ? ` · ${template.name_en}` : ""}
              {sentResult.code ? ` · ${sentResult.code}` : ""}
            </span>
          }
          breadcrumbs={breadcrumbs}
          actions={
            <span className="inline-flex items-center rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              {tRcm("youSend")}
            </span>
          }
        />
        <AppListCard className="space-y-3 p-4">
          <p className="text-sm font-semibold">{t("successBody", { count: 1 })}</p>
          <p className="text-xs text-muted-foreground">{t("successFooter")}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button className="h-9" render={<Link href={requestHref} />}>
              {tRcm("sentForSignature")}
            </Button>
            <Button variant="outline" className="h-9" render={<Link href={batchHref} />}>
              {tRcm("batches")}
            </Button>
            <Button variant="outline" className="h-9" render={<Link href={hubHref} />}>
              {t("back")}
            </Button>
          </div>
        </AppListCard>
      </AppPage>
    );
  }

  const renderPreview = (fill: boolean) =>
    template ? (
    <EsignDocumentPreview
      templateName={title || template.name_en}
      nameAr={template.name_ar}
      company={snapshot?.company_name || tBuilder("previewCompany")}
      body={template.body_en}
      bodyAr={template.body_ar}
      declaration={template.declaration_en}
      declarationAr={template.declaration_ar}
      fields={(isPenalty ? withAbsenceDateFields(template.fields, template.id) : template.fields).map(
        (field) =>
          isPenaltyActionFieldKey(field.field_key)
            ? { ...field, options: defaultPenaltyActionOptions(field) }
            : field,
      )}
      values={previewValues}
      fill={fill}
      documentKind={template.document_kind}
      signers={{
        employeeLabel: tBuilder("previewEmployeeSignature"),
        staffLabel: previewStaffLabel(
          staffSigners,
          pickedStaffName,
          tBuilder("previewStaffSignature"),
        ),
      }}
    />
  ) : null;

  const previewCard = (
    <AppListCard
      className={cn(
        isV2 ? "flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-0" : "space-y-3 p-4",
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-1",
          isV2 && "shrink-0 px-4 pt-3",
        )}
      >
        <p className="text-sm font-semibold">{t("documentPreview")}</p>
        <button
          type="button"
          className={`text-xs font-semibold disabled:text-muted-foreground ${
            isV2 ? "text-[#EA580C]" : "text-primary"
          }`}
          disabled={!template}
          onClick={() => setFullOpen(true)}
        >
          {t("seeFullDocument")}
        </button>
        <Link
          href={bulkHref}
          className={`text-xs font-semibold ${isV2 ? "text-[#EA580C]" : "text-[#B54708]"}`}
        >
          {t("manyEmployees")}
        </Link>
      </div>
      <div
        className={cn(
          "flex flex-wrap gap-3 text-[11px] text-muted-foreground",
          isV2 && "shrink-0 px-4 pb-2",
        )}
      >
        <LegendDot color="bg-[#2563EB]" label={t("sourceSystem")} />
        <LegendDot color="bg-[#16A34A]" label={t("sourceEntry")} />
        <LegendDot color="bg-[#0A0A0A]" label={t("sourceFixed")} />
        <LegendDot color={isV2 ? "bg-[#7C3AED]" : "bg-[#EA580C]"} label={t("sourceSigned")} />
      </div>
      <div className={isV2 ? "relative min-h-0 flex-1 overflow-hidden" : undefined}>
        {renderPreview(isV2)}
      </div>
    </AppListCard>
  );

  return (
    <AppPage
      className={
        isV2
          ? `flex ${LAYOUT.commandViewportHeight} min-h-0 flex-col space-y-2`
          : undefined
      }
    >
      {isV2 ? (
        <div className="shrink-0 space-y-2">
          <Link
            href={hubHref}
            className="inline-flex h-9 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {t("backToOutgoing")}
          </Link>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-[#FEC84B] bg-[#FFFAEB] text-[#B54708]">
                <FileText className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <h1 className="text-base font-semibold">{t("createTitle")}</h1>
                <p className="text-xs text-muted-foreground">{t("createSubtitle")}</p>
              </div>
            </div>
            <span className="shrink-0 rounded-md bg-[#FFFAEB] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#B54708]">
              {tRcm("youSend")}
            </span>
          </div>
        </div>
      ) : (
        <AppPageHeader
          title={title.trim() || t("title")}
          description={t("subtitle")}
          breadcrumbs={breadcrumbs}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {templateId ? (
                <Button variant="outline" className="h-9" render={<Link href={editHref} />}>
                  <PencilLine className="size-4" />
                  {tBuilder("editTemplate")}
                </Button>
              ) : null}
              <Button variant="outline" className="h-9" render={<Link href={hubHref} />}>
                {t("back")}
              </Button>
            </div>
          }
        />
      )}

      <div
        className={cn(
          "grid gap-2",
          isV2
            ? "min-h-0 flex-1 lg:grid-cols-2 lg:items-stretch"
            : "lg:grid-cols-2 lg:items-start",
        )}
      >
        {isV2 ? previewCard : null}
        <AppListCard className={cn("space-y-3 p-4", isV2 && "h-full min-h-0 min-w-0 overflow-y-auto")}>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>
                {t("fieldTemplate")}
                {isV2 ? null : <span className="text-destructive"> *</span>}
              </Label>
              <SearchSelect
                items={templateItems}
                value={templateId}
                onChange={setTemplateId}
                placeholder={t("fieldTemplatePlaceholder")}
                searchPlaceholder={t("fieldTemplateSearch")}
                recentsKey="esign-send-template"
                className="w-full"
              />
              {initialCategoryKey && categoryTemplates.length === 0 && templatesData ? (
                <p className="text-[11px] text-muted-foreground">
                  {t("emptyCategory")}{" "}
                  <Link href={templatesHref} className="font-medium text-primary hover:underline">
                    {t("openLibrary")}
                  </Link>
                </p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label>
                {t("fieldEmployeeId")}
                {isV2 ? null : <span className="text-destructive"> *</span>}
              </Label>
              <SearchSelect
                items={driverItems}
                value={driverId}
                onChange={setDriverId}
                placeholder={t("fieldDriverPlaceholder")}
                searchPlaceholder={t("fieldDriverSearch")}
                recentsKey="esign-send-driver"
                className="w-full"
              />
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-3">
            <p className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-[#1D4ED8]">
              {isV2 ? <Building2 className="size-3" aria-hidden /> : null}
              {t("fromTheSystem")}
            </p>
            <div className="grid grid-cols-3 gap-x-3 gap-y-2">
              <SystemFact label={t("company")} value={shown(snapshot?.company_name)} />
              <SystemFact label={t("employeeName")} value={shown(snapshot?.employee_name)} />
              <SystemFact label={t("fieldPosition")} value={shown(snapshot?.position)} />
              <SystemFact label={t("fieldCivilId")} value={shown(snapshot?.civil_id)} />
              <SystemFact label={t("fieldSponsor")} value={shown(snapshot?.sponsor)} />
              <SystemFact label={t("fieldPayThrough")} value={shown(snapshot?.pay_through)} />
              <SystemFact
                label={t("fieldBank")}
                value={maskBankNumber(snapshot?.bank_number)}
              />
              {isV2 ? null : (
                <SystemFact label={t("employeeId")} value={shown(snapshot?.employee_id)} />
              )}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>
                {t("fieldTitle")} <span className="text-destructive">*</span>
              </Label>
              <Input
                className="h-9"
                value={title}
                placeholder={t("fieldTitlePlaceholder")}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("fieldDue")}</Label>
              <Input
                type="date"
                className="h-9"
                min={kuwaitTodayYmd()}
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
          </div>
          {isV2 ? null : (
            <div className="space-y-1">
              <Label>{t("fieldDescription")}</Label>
              <Textarea
                className="min-h-16"
                value={description}
                placeholder={t("fieldDescriptionPlaceholder")}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          )}

          {sheetFields.length > 0 || isPenalty ? (
            <div className="space-y-2">
              {isV2 ? null : <p className="text-xs font-semibold">{t("sheetInputs")}</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                {sheetFields.map((field) =>
                  renderField(field, isPayslip ? PAYSLIP_MONEY_CODES[field.field_key] : undefined),
                )}
                {isPenalty &&
                !sheetFields.some(
                  (field) => field.field_key === "absence_from" || field.field_key === "from_date",
                ) ? (
                  <div className="space-y-1">
                    <Label>{t("absenceFrom")}</Label>
                    <Input
                      type="date"
                      className="h-9"
                      value={values.absence_from ?? ""}
                      placeholder={t("fieldAbsenceFrom")}
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, absence_from: e.target.value }))
                      }
                    />
                  </div>
                ) : null}
                {isPenalty &&
                !sheetFields.some(
                  (field) => field.field_key === "absence_to" || field.field_key === "to_date",
                ) ? (
                  <div className="space-y-1">
                    <Label>{t("absenceTo")}</Label>
                    <Input
                      type="date"
                      className="h-9"
                      value={values.absence_to ?? ""}
                      placeholder={t("fieldAbsenceTo")}
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, absence_to: e.target.value }))
                      }
                    />
                  </div>
                ) : null}
                {isPenalty && penaltyCatalogue.length > 0 ? (
                  <div className="space-y-1.5 sm:col-span-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label>{t("penaltyOptions")}</Label>
                      {hiddenCheckKeys.length > 0 ? (
                        <button
                          type="button"
                          className="inline-flex h-7 items-center rounded-md px-1.5 text-[11px] font-medium text-primary hover:bg-primary/10"
                          onClick={() => setHiddenCheckKeys([])}
                        >
                          {t("showHiddenOptions")}
                        </button>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {penaltyCatalogue
                        .filter((check) => !hiddenCheckKeys.includes(check.key))
                        .map((check) => (
                          <span key={check.key} className="inline-flex items-center gap-0.5">
                            <ToggleChip
                              selected={selectedCheckKeys.includes(check.key)}
                              onClick={() =>
                                setSelectedCheckKeys((prev) =>
                                  prev.includes(check.key)
                                    ? prev.filter((key) => key !== check.key)
                                    : [...prev, check.key],
                                )
                              }
                            >
                              {check.label.en}
                            </ToggleChip>
                            <button
                              type="button"
                              className="inline-flex size-7 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
                              aria-label={t("hideOption")}
                              onClick={() => {
                                setHiddenCheckKeys((prev) => [...prev, check.key]);
                                setSelectedCheckKeys((prev) =>
                                  prev.filter((key) => key !== check.key),
                                );
                              }}
                            >
                              <Trash2 className="size-3" aria-hidden />
                            </button>
                          </span>
                        ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {isV2 ? null : (
            <EsignSignersEditor
              draft={staffSigners}
              onDraftChange={setStaffSigners}
              onSelectedDisplayNameChange={setPickedStaffName}
            />
          )}

          <div className="flex flex-col gap-2">
            <Button
              className="h-9 w-full bg-[#0A0A0A] text-white hover:bg-[#262626]"
              disabled={create.isPending || !driverId || !templateId || !resolvedTitle}
              onClick={() => void submit()}
            >
              {create.isPending ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {t("sendForSignature")}
            </Button>
            <Button
              variant="outline"
              className="h-9 w-full cursor-pointer"
              disabled={savingDraft || !templateId || !resolvedTitle}
              onClick={() => void saveDraft()}
            >
              {savingDraft ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {draftId ? t("updateDraft") : t("saveDraft")}
            </Button>
            {isV2 ? null : (
              <Button
                variant="ghost"
                className="h-9 cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground"
                render={<Link href={draftsHref} />}
              >
                <FileClock className="me-1.5 h-3.5 w-3.5" />
                {t("draftsLink")}
              </Button>
            )}
          </div>
        </AppListCard>
        {isV2 ? null : previewCard}
      </div>

      <Dialog open={fullOpen} onOpenChange={setFullOpen}>
        <DialogContent className="w-[min(1200px,96vw)] max-w-none" showCloseButton>
          <DialogHeader className="border-b border-border px-5 py-3 pe-12">
            <DialogTitle>{title || template?.name_en || t("documentPreview")}</DialogTitle>
            {template?.name_ar ? (
              <DialogDescription dir="rtl">{template.name_ar}</DialogDescription>
            ) : (
              <DialogDescription>{t("seeFullDocument")}</DialogDescription>
            )}
          </DialogHeader>
          <div className="max-h-[min(70vh,640px)] overflow-y-auto px-5 py-4">{renderPreview(false)}</div>
          <DialogFooter className="border-t border-border px-5 py-3">
            <Button type="button" variant="outline" className="h-9" onClick={() => setFullOpen(false)}>
              {t("back")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppPage>
  );
}

function SystemFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-[#1D4ED8]">{label}</div>
      <div className="truncate text-xs font-medium text-[#0A0A0A]">{value}</div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`size-1.5 rounded-full ${color}`} aria-hidden />
      {label}
    </span>
  );
}
