"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { FileText, Loader2, Plus, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { ToggleChip } from "@/components/app/toggle-chip";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { selectOptions } from "@/lib/select-items";
import { SectionHeading } from "@/features/drivers/form/driver-form-primitives";
import {
  deleteEsignTemplateField,
  upsertEsignTemplate,
  upsertEsignTemplateField,
} from "./esign-sender-actions";
import { useEsignCategories, useEsignTemplate } from "./use-esign";
import { ESIGN_RESERVED_FIELD_KEYS, type EsignTemplateFieldType } from "./types";
import { EMPLOYEE_PLACEHOLDER_KEYS } from "./render/esign-placeholders";

const FIELD_TYPES: EsignTemplateFieldType[] = ["text", "textarea", "number", "date", "select"];

export function EsignTemplateBuilderShell({ templateId }: { templateId: string }) {
  const t = useTranslations("pages.requests.esign.templates");
  const tHub = useTranslations("pages.requests.esign.hub");
  const queryClient = useQueryClient();
  const { data, isLoading } = useEsignTemplate(templateId);
  const { data: categoriesData } = useEsignCategories();
  const template = data?.template;

  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [categoryKey, setCategoryKey] = useState("");
  const [language, setLanguage] = useState<"en" | "ar">("en");
  const [active, setActive] = useState(true);
  const [headerEn, setHeaderEn] = useState("");
  const [headerAr, setHeaderAr] = useState("");
  const [bodyEn, setBodyEn] = useState("");
  const [bodyAr, setBodyAr] = useState("");
  const [declEn, setDeclEn] = useState("");
  const [declAr, setDeclAr] = useState("");
  const [target, setTarget] = useState<"header" | "body" | "declaration">("body");
  const [saving, setSaving] = useState(false);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [fieldKey, setFieldKey] = useState("");
  const [fieldLabelEn, setFieldLabelEn] = useState("");
  const [fieldLabelAr, setFieldLabelAr] = useState("");
  const [fieldType, setFieldType] = useState<EsignTemplateFieldType>("text");
  const [fieldRequired, setFieldRequired] = useState(false);

  useEffect(() => {
    if (!template) return;
    setNameEn(template.name_en);
    setNameAr(template.name_ar ?? "");
    setCategoryKey(template.category_key);
    setLanguage(template.default_language);
    setActive(template.is_active);
    setHeaderEn(template.header_en);
    setHeaderAr(template.header_ar);
    setBodyEn(template.body_en);
    setBodyAr(template.body_ar);
    setDeclEn(template.declaration_en);
    setDeclAr(template.declaration_ar);
  }, [template]);

  const categories = useMemo(
    () => categoriesData?.rows.filter((c) => c.is_active) ?? [],
    [categoriesData?.rows],
  );

  function insertToken(key: string) {
    const token = `{{${key}}}`;
    const apply = (prev: string) => (prev ? `${prev} ${token}` : token);
    if (target === "header") {
      if (language === "ar") setHeaderAr(apply);
      else setHeaderEn(apply);
    } else if (target === "declaration") {
      if (language === "ar") setDeclAr(apply);
      else setDeclEn(apply);
    } else if (language === "ar") setBodyAr(apply);
    else setBodyEn(apply);
  }

  async function saveTemplate() {
    if (!nameEn.trim() || !categoryKey) {
      toast.error(t("errors.missingFields"));
      return;
    }
    setSaving(true);
    const result = await upsertEsignTemplate({
      id: templateId,
      name_en: nameEn.trim(),
      name_ar: nameAr.trim() || null,
      category_key: categoryKey,
      default_language: language,
      is_active: active,
      header_en: headerEn,
      header_ar: headerAr,
      body_en: bodyEn,
      body_ar: bodyAr,
      declaration_en: declEn,
      declaration_ar: declAr,
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error ?? t("errors.saveFailed"));
      return;
    }
    toast.success(t("saved"));
    await queryClient.invalidateQueries({ queryKey: queryKeys.esign.template(templateId) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.esign.templates() });
  }

  async function saveField() {
    const result = await upsertEsignTemplateField({
      template_id: templateId,
      field_key: fieldKey,
      label_en: fieldLabelEn,
      label_ar: fieldLabelAr || null,
      field_type: fieldType,
      is_required: fieldRequired,
      sort_order: template?.fields.length ?? 0,
    });
    if (!result.ok) {
      toast.error(result.error === "invalid_field_key" ? t("errors.invalidFieldKey") : (result.error ?? t("errors.saveFailed")));
      return;
    }
    toast.success(t("fieldAdded"));
    setFieldOpen(false);
    setFieldKey("");
    setFieldLabelEn("");
    setFieldLabelAr("");
    setFieldType("text");
    setFieldRequired(false);
    await queryClient.invalidateQueries({ queryKey: queryKeys.esign.template(templateId) });
  }

  async function removeField(id: string) {
    const result = await deleteEsignTemplateField(id);
    if (!result.ok) {
      toast.error(result.error ?? t("errors.deleteFailed"));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.esign.template(templateId) });
  }

  if (isLoading) {
    return (
      <AppPage>
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppPage>
    );
  }
  if (!template) {
    return (
      <AppPage>
        <AppEmptyState title={t("notFound")} description={data?.error ?? t("emptyDescription")} />
      </AppPage>
    );
  }

  const chips = [
    ...EMPLOYEE_PLACEHOLDER_KEYS,
    ...template.fields.map((f) => f.field_key),
  ];

  return (
    <AppPage>
      <AppPageHeader
        title={template.name_en}
        description={t("builderSubtitle")}
        breadcrumbs={[
          { label: tHub("requests"), href: "/requests" },
          { label: tHub("title"), href: "/requests/esign" },
          { label: t("title"), href: "/requests/esign/templates" },
          { label: template.name_en },
        ]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-9" render={<Link href="/requests/esign/templates" />}>
              {t("back")}
            </Button>
            <Button size="sm" className="h-9" disabled={saving} onClick={() => void saveTemplate()}>
              {saving ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {t("save")}
            </Button>
          </div>
        }
      />

      <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
        <AppListCard className="h-full space-y-3 p-4">
          <SectionHeading icon={FileText} accent="primary">
            {t("identity")}
          </SectionHeading>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t("fieldNameEn")}</Label>
              <Input className="h-9" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t("fieldNameAr")}</Label>
              <Input className="h-9" dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t("fieldCategory")}</Label>
              <Select
                items={selectOptions(categories.map((c) => ({ value: c.key, label: c.label_en })))}
                value={categoryKey || undefined}
                onValueChange={(v) => setCategoryKey(v ?? "")}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label_en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("fieldLanguage")}</Label>
              <div className="flex gap-1">
                <ToggleChip selected={language === "en"} onClick={() => setLanguage("en")}>
                  EN
                </ToggleChip>
                <ToggleChip selected={language === "ar"} onClick={() => setLanguage("ar")}>
                  AR
                </ToggleChip>
                <ToggleChip selected={active} onClick={() => setActive((v) => !v)}>
                  {active ? t("active") : t("inactive")}
                </ToggleChip>
              </div>
            </div>
          </div>
        </AppListCard>

        <AppListCard className="h-full space-y-3 p-4">
          <SectionHeading icon={UserRound} accent="success">
            {t("employeeBlock")}
          </SectionHeading>
          <p className="text-[10px] text-muted-foreground">{t("employeeBlockHint")}</p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5">{t("company")}</div>
            <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5">{t("employeeName")}</div>
            <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5">{t("employeeId")}</div>
          </div>
        </AppListCard>
      </div>

      <AppListCard className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-1">
          {(["header", "body", "declaration"] as const).map((key) => (
            <ToggleChip key={key} selected={target === key} onClick={() => setTarget(key)}>
              {t(`section.${key}`)}
            </ToggleChip>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {chips.map((key) => (
            <ToggleChip
              key={key}
              selected={false}
              onClick={() => insertToken(key)}
            >
              {`{{${key}}}`}
            </ToggleChip>
          ))}
        </div>
        <div className="grid gap-2 lg:grid-cols-2">
          <div className="space-y-1">
            <Label>{t("section.header")} EN</Label>
            <Textarea className="min-h-16" value={headerEn} onChange={(e) => setHeaderEn(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("section.header")} AR</Label>
            <Textarea className="min-h-16" dir="rtl" value={headerAr} onChange={(e) => setHeaderAr(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("section.body")} EN</Label>
            <Textarea className="min-h-24" value={bodyEn} onChange={(e) => setBodyEn(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("section.body")} AR</Label>
            <Textarea className="min-h-24" dir="rtl" value={bodyAr} onChange={(e) => setBodyAr(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("section.declaration")} EN</Label>
            <Textarea className="min-h-16" value={declEn} onChange={(e) => setDeclEn(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("section.declaration")} AR</Label>
            <Textarea className="min-h-16" dir="rtl" value={declAr} onChange={(e) => setDeclAr(e.target.value)} />
          </div>
        </div>
      </AppListCard>

      <AppListCard className="p-0">
        <div className="flex items-center justify-between p-4">
          <SectionHeading icon={FileText} accent="warning">
            {t("fields")}
          </SectionHeading>
          <Button size="sm" className="h-9" onClick={() => setFieldOpen(true)}>
            <Plus className="me-1.5 h-3.5 w-3.5" />
            {t("addField")}
          </Button>
        </div>
        {template.fields.length === 0 ? (
          <div className="px-4 pb-4 text-[11px] text-muted-foreground">{t("noFields")}</div>
        ) : (
          <AppDataTable
            columns={[
              { id: "key", label: t("colKey") },
              { id: "label", label: t("colLabel") },
              { id: "type", label: t("colType") },
              { id: "req", label: t("colRequired") },
              { id: "act", label: t("colActions") },
            ]}
          >
            {template.fields.map((field) => (
              <AppDataTableRow key={field.id}>
                <TableCell className="font-mono text-xs">{field.field_key}</TableCell>
                <TableCell className="text-sm">
                  {field.label_en}
                  {field.label_ar ? (
                    <div className="text-[11px] text-muted-foreground">{field.label_ar}</div>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm">{field.field_type}</TableCell>
                <TableCell className="text-sm">{field.is_required ? t("required") : "—"}</TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-destructive hover:bg-destructive/10"
                    onClick={() => void removeField(field.id)}
                  >
                    <Trash2 className="me-1 h-3.5 w-3.5" />
                    {t("remove")}
                  </Button>
                </TableCell>
              </AppDataTableRow>
            ))}
          </AppDataTable>
        )}
      </AppListCard>

      <Dialog open={fieldOpen} onOpenChange={setFieldOpen}>
        <DialogContent className="overflow-visible pt-4" showCloseButton closeOutside>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>
                {t("fieldKey")} <span className="text-destructive">*</span>
              </Label>
              <Input
                className="h-9 font-mono"
                value={fieldKey}
                onChange={(e) => setFieldKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                placeholder="penalty_amount"
              />
              <p className="text-[10px] text-muted-foreground">
                {t("reservedHint", { keys: ESIGN_RESERVED_FIELD_KEYS.join(", ") })}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>
                  {t("fieldLabelEn")} <span className="text-destructive">*</span>
                </Label>
                <Input className="h-9" value={fieldLabelEn} onChange={(e) => setFieldLabelEn(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t("fieldLabelAr")}</Label>
                <Input className="h-9" dir="rtl" value={fieldLabelAr} onChange={(e) => setFieldLabelAr(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                items={selectOptions(FIELD_TYPES.map((v) => ({ value: v, label: v })))}
                value={fieldType}
                onValueChange={(v) => setFieldType((v as EsignTemplateFieldType) ?? "text")}
              >
                <SelectTrigger className="h-9 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ToggleChip selected={fieldRequired} onClick={() => setFieldRequired((v) => !v)}>
                {t("required")}
              </ToggleChip>
            </div>
          </div>
          <AppModalFooter title={t("addFieldTitle")} subtitle={t("addFieldSubtitle")}>
            <Button variant="outline" className="h-9" onClick={() => setFieldOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              className="h-9"
              disabled={!fieldKey || !fieldLabelEn.trim()}
              onClick={() => void saveField()}
            >
              {t("addField")}
            </Button>
          </AppModalFooter>
        </DialogContent>
      </Dialog>
    </AppPage>
  );
}
