"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { Textarea } from "@/components/ui/textarea";
import { Link, useRouter } from "@/i18n/navigation";
import { driverSearchOptions } from "@/lib/search-options";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { isEsignDueDateAllowed } from "./esign-due-date";
import { fetchEsignSnapshot, saveEsignDraft } from "./esign-sender-actions";
import {
  useCreateEsignFromTemplate,
  useEsignDriverOptions,
  useEsignDraft,
  useEsignTemplate,
  useEsignTemplates,
} from "./use-esign";
import type { EsignEmployeeSnapshot } from "./render/esign-placeholders";
import type { EsignLocale } from "./types";

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
}: {
  initialTemplateId?: string;
  initialDraftId?: string;
}) {
  const t = useTranslations("pages.requests.esign.send");
  const tHub = useTranslations("pages.requests.esign.hub");
  const router = useRouter();
  const { data: templatesData } = useEsignTemplates();
  const { data: driversData } = useEsignDriverOptions();
  const create = useCreateEsignFromTemplate();

  const templates = useMemo(
    () => (templatesData?.rows ?? []).filter((row) => row.is_active),
    [templatesData?.rows],
  );
  const [templateId, setTemplateId] = useState<string | null>(initialTemplateId ?? null);
  const { data: templateData } = useEsignTemplate(templateId ?? "");
  const template = templateData?.template;

  const [driverId, setDriverId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<EsignEmployeeSnapshot | null>(null);
  const [title, setTitle] = useState("");
  const [locale, setLocale] = useState<EsignLocale>("en");
  const [dueAt, setDueAt] = useState("");
  const [description, setDescription] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});

  /**
   * The draft this composer is editing, if any. Held as state rather than read
   * from the prop so the first "Save draft" turns a fresh send into a draft and
   * every later save updates that same row instead of piling up copies.
   */
  const [draftId, setDraftId] = useState<string | null>(initialDraftId ?? null);
  const [savingDraft, setSavingDraft] = useState(false);
  const draftQuery = useEsignDraft(initialDraftId ?? "");
  /**
   * One-shot. A draft payload is the *starting* state, so it may only be
   * applied once: re-applying it on every refetch would silently undo whatever
   * the operator has typed since, which is exactly the work the draft exists to
   * protect. Same reason the template default effect below defers to it.
   */
  const draftAppliedRef = useRef(false);

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
      templates.map((row) => ({
        value: row.id,
        label: row.name_en,
        hint: row.category_key,
        keywords: [row.name_en, row.name_ar, row.category_key, row.id].filter(Boolean) as string[],
      })),
    [templates],
  );

  useEffect(() => {
    const draft = draftQuery.data?.draft;
    if (!draft || draftAppliedRef.current) return;
    draftAppliedRef.current = true;
    if (draft.template_id) setTemplateId(draft.template_id);
    setLocale(draft.language);
    if (draft.title) setTitle(draft.title);
    if (draft.due_at) setDueAt(draft.due_at.slice(0, 10));
    if (draft.description) setDescription(draft.description);
    setValues(draft.field_values);
    const firstRow = draft.rows[0];
    if (firstRow?.driver_id) setDriverId(firstRow.driver_id);
  }, [draftQuery.data?.draft]);

  useEffect(() => {
    if (!template) return;
    // A resumed draft is authoritative: its title, language and field values are
    // what the operator last saw, and re-seeding them from the template would
    // quietly replace that with the template's own defaults.
    if (draftAppliedRef.current) return;
    setTitle((prev) => prev || template.name_en);
    setLocale(template.default_language);
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
      setSnapshot(result.snapshot);
    });
  }, [driverId]);

  async function submit() {
    if (!driverId || !templateId || !title.trim()) {
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
      title: title.trim(),
      locale,
      due_at: dueAt || null,
      description: description.trim() || null,
      field_values: values,
    });
    if (!result.ok) {
      toast.error(result.error ?? t("errors.createFailed"));
      return;
    }
    toast.success(t("created", { code: result.request_code ?? "" }));
    if (result.id) router.push(`/requests/esign/${result.id}`);
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
      language: locale,
      title: title.trim() || template?.name_en || null,
      due_at: dueAt || null,
      description: description.trim() || null,
      field_values: values,
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

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: tHub("requests"), href: "/requests" },
          { label: tHub("title"), href: "/requests/esign" },
          { label: t("title") },
        ]}
        actions={
          <Button variant="outline" size="sm" className="h-9" render={<Link href="/requests/esign" />}>
            {t("back")}
          </Button>
        }
      />

      <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
        <AppListCard className="h-full space-y-3 p-4">
          <div className="space-y-1">
            <Label>
              {t("fieldTemplate")} <span className="text-destructive">*</span>
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
          </div>
          <div className="space-y-1">
            <Label>
              {t("fieldDriver")} <span className="text-destructive">*</span>
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
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
              <div className="text-[10px] text-muted-foreground">{t("company")}</div>
              {snapshot?.company_name || "—"}
            </div>
            <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
              <div className="text-[10px] text-muted-foreground">{t("employeeName")}</div>
              {snapshot?.employee_name || "—"}
            </div>
            <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
              <div className="text-[10px] text-muted-foreground">{t("employeeId")}</div>
              {snapshot?.employee_id || "—"}
            </div>
          </div>
        </AppListCard>

        <AppListCard className="h-full space-y-3 p-4">
          <div className="space-y-1">
            <Label>
              {t("fieldTitle")} <span className="text-destructive">*</span>
            </Label>
            <Input className="h-9" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t("fieldLocale")}</Label>
              <div className="flex gap-1">
                <ToggleChip selected={locale === "en"} onClick={() => setLocale("en")}>
                  EN
                </ToggleChip>
                <ToggleChip selected={locale === "ar"} onClick={() => setLocale("ar")}>
                  AR
                </ToggleChip>
              </div>
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
          <div className="space-y-1">
            <Label>{t("fieldDescription")}</Label>
            <Textarea className="min-h-16" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </AppListCard>
      </div>

      {template && template.fields.length > 0 ? (
        <AppListCard className="space-y-3 p-4">
          <p className="text-xs font-semibold">{t("categoryFields")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {template.fields.map((field) => (
              <div key={field.id} className="space-y-1">
                <Label>
                  {field.label_en}
                  {field.is_required ? <span className="text-destructive"> *</span> : null}
                </Label>
                {field.field_type === "textarea" ? (
                  <Textarea
                    className="min-h-16"
                    value={values[field.field_key] ?? ""}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [field.field_key]: e.target.value }))
                    }
                  />
                ) : (
                  <Input
                    className="h-9"
                    type={field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"}
                    value={values[field.field_key] ?? ""}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [field.field_key]: e.target.value }))
                    }
                  />
                )}
              </div>
            ))}
          </div>
        </AppListCard>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground"
          render={<Link href="/requests/esign/drafts" />}
        >
          <FileClock className="me-1.5 h-3.5 w-3.5" />
          {t("draftsLink")}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="h-9 cursor-pointer"
            disabled={savingDraft || !templateId || !title.trim()}
            onClick={() => void saveDraft()}
          >
            {savingDraft ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {draftId ? t("updateDraft") : t("saveDraft")}
          </Button>
          <Button
            className="h-9"
            disabled={create.isPending || !driverId || !templateId || !title.trim()}
            onClick={() => void submit()}
          >
            {create.isPending ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {t("send")}
          </Button>
        </div>
      </div>
    </AppPage>
  );
}
