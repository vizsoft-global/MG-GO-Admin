"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
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
import { fetchEsignSnapshot } from "./esign-sender-actions";
import {
  useCreateEsignFromTemplate,
  useEsignDriverOptions,
  useEsignTemplate,
  useEsignTemplates,
} from "./use-esign";
import type { EsignEmployeeSnapshot } from "./render/esign-placeholders";
import type { EsignLocale } from "./types";

export function EsignSendShell() {
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
  const [templateId, setTemplateId] = useState<string | null>(null);
  const { data: templateData } = useEsignTemplate(templateId ?? "");
  const template = templateData?.template;

  const [driverId, setDriverId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<EsignEmployeeSnapshot | null>(null);
  const [title, setTitle] = useState("");
  const [locale, setLocale] = useState<EsignLocale>("en");
  const [dueAt, setDueAt] = useState("");
  const [description, setDescription] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});

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
    if (!template) return;
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

      <div className="flex justify-end">
        <Button
          className="h-9"
          disabled={create.isPending || !driverId || !templateId || !title.trim()}
          onClick={() => void submit()}
        >
          {create.isPending ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          {t("send")}
        </Button>
      </div>
    </AppPage>
  );
}
