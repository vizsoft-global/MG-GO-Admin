"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Plus, TriangleAlert } from "lucide-react";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect, type SearchSelectItem } from "@/components/ui/search-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TYPE_FIELDS } from "./request-typed-fields";
import { REQUEST_TYPE_SLUGS } from "./settings-types";
import type {
  RequestCreateFieldOption,
  RequestCreateOptions,
  RequestCreateTypeOption,
} from "./types";
import { useCreateRequestOnBehalf, useRequestCreateOptions } from "./use-requests";

const SYSTEM_TYPES = new Set<string>(REQUEST_TYPE_SLUGS);

const SEVERITIES = ["low", "medium", "high"] as const;

/** Payload keys the rider app sends as free text — there is no configured vocabulary for them. */
const TEXT_KEYS = new Set([
  "leave_type",
  "leave_subtype",
  "asset_type",
  "size",
  "request_mode",
  "asset_current_status",
  "document_type",
  "language",
  "delivery_method",
  "subject",
  "title",
]);
const NUMBER_KEYS = new Set([
  "quantity",
  "distance_km",
  "expected_amount",
  "received_amount",
]);
const MONTH_KEYS = new Set(["period_month", "salary_month"]);
const DATE_KEYS = new Set(["needed_by"]);
const LONG_TEXT_KEYS = new Set([
  "comment",
  "justification",
  "reason",
  "description",
  "symptoms_details",
]);

type Draft = Record<string, string>;

function typeLabel(
  t: ReturnType<typeof useTranslations<"pages.requests">>,
  locale: string,
  row: RequestCreateTypeOption,
): string {
  if (SYSTEM_TYPES.has(row.key)) return t(`types.${row.key}` as "types.leave");
  if (locale.startsWith("ar") && row.label_ar) return row.label_ar;
  return row.label_en || row.key;
}

function fieldLabelFor(
  t: ReturnType<typeof useTranslations<"pages.requests">>,
  locale: string,
  field: RequestCreateFieldOption,
): string {
  if (locale.startsWith("ar") && field.label_ar) return field.label_ar;
  return field.label_en || field.field_key;
}

function isBlocked(
  type: string,
  options: RequestCreateOptions | undefined,
): "tenure" | "category" | "sickDocs" | "attachments" | null {
  if (type === "sick_leave") return "sickDocs";
  if (type === "loan" && (options?.loanTenures.length ?? 0) === 0) return "tenure";
  if (type === "complaint" && (options?.complaintCategories.length ?? 0) === 0) {
    return "category";
  }
  const def = options?.types.find((row) => row.key === type);
  if (def && !SYSTEM_TYPES.has(type) && def.min_attachments > 0) return "attachments";
  return null;
}

export function RequestCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.requests");
  const locale = useLocale();
  const [driverId, setDriverId] = useState<string | null>(null);
  const [type, setType] = useState<string>("leave");
  const [draft, setDraft] = useState<Draft>({});
  const [declaration, setDeclaration] = useState(false);

  const { data: options, isLoading } = useRequestCreateOptions(open);
  const create = useCreateRequestOnBehalf();

  const typeDef = options?.types.find((row) => row.key === type);
  const isTyped = Boolean(TYPE_FIELDS[type]);
  const dynamicFields = useMemo(
    () =>
      (options?.fields ?? [])
        .filter((field) => field.type_key === type)
        .sort((a, b) => a.sort_order - b.sort_order),
    [options?.fields, type],
  );

  useEffect(() => {
    const keys = options?.types.map((row) => row.key) ?? [];
    if (keys.length > 0 && !keys.includes(type)) setType(keys[0]);
  }, [options?.types, type]);

  const typeItems = useMemo<SearchSelectItem[]>(
    () =>
      (options?.types ?? []).map((row) => ({
        value: row.key,
        label: typeLabel(t, locale, row),
        keywords: [row.key, row.label_en, row.label_ar ?? ""],
      })),
    [options?.types, locale, t],
  );

  const driverItems = useMemo<SearchSelectItem[]>(
    () =>
      (options?.drivers ?? []).map((driver) => ({
        value: driver.id,
        label: driver.full_name,
        hint: [driver.driver_code, driver.employee_id, driver.phone]
          .filter(Boolean)
          .join(" · "),
        keywords: [
          driver.full_name,
          driver.driver_code,
          driver.employee_id ?? "",
          driver.phone ?? "",
        ].filter(Boolean),
      })),
    [options?.drivers],
  );

  const fields = TYPE_FIELDS[type] ?? [];
  const payloadFields = fields.filter(
    (field) => field.from !== "column" && field.key !== "declaration_accepted",
  );
  const hasDeclaration = isTyped
    ? fields.some((field) => field.key === "declaration_accepted")
    : dynamicFields.some((field) => field.field_key === "declaration_accepted");
  const hasAmount = isTyped
    ? fields.some((field) => field.key === "amount_kwd")
    : dynamicFields.some((field) => field.target === "amount_kwd");
  const hasDates = isTyped
    ? fields.some((field) => field.key === "start_date")
    : Boolean(typeDef?.date_range_required) ||
      dynamicFields.some((field) => field.target === "start_date" || field.target === "end_date");
  const hasSeverity = isTyped
    ? fields.some((field) => field.key === "severity")
    : dynamicFields.some((field) => field.target === "severity");
  const blocked = isBlocked(type, options);

  const value = (key: string) => draft[key] ?? "";
  const set = (key: string, next: string) =>
    setDraft((current) => ({ ...current, [key]: next }));

  const reset = () => {
    setDriverId(null);
    setType("leave");
    setDraft({});
    setDeclaration(false);
  };

  const extraDynamic = dynamicFields.filter(
    (field) =>
      field.kind !== "file" &&
      field.target !== "attachments" &&
      field.target !== "start_date" &&
      field.target !== "end_date" &&
      field.target !== "amount_kwd" &&
      field.target !== "severity" &&
      field.field_key !== "declaration_accepted",
  );

  const missingRequired =
    !driverId ||
    (hasDates && (!value("start_date") || !value("end_date"))) ||
    (hasDeclaration && !declaration) ||
    extraDynamic.some(
      (field) =>
        field.is_required &&
        (field.kind === "checkbox"
          ? value(field.field_key) !== "true"
          : !value(field.field_key).trim()),
    );

  const submit = async () => {
    if (!driverId || blocked) return;

    const payload: Record<string, string | number | boolean | string[]> = {};
    let details: string | null = null;
    if (isTyped) {
      for (const field of payloadFields) {
        const raw = value(field.key).trim();
        if (!raw) continue;
        payload[field.key] = NUMBER_KEYS.has(field.key) ? Number(raw) : raw;
      }
    } else {
      for (const field of extraDynamic) {
        const raw = value(field.field_key).trim();
        if (!raw && field.kind !== "checkbox") continue;
        const parsed =
          field.kind === "number"
            ? Number(raw)
            : field.kind === "checkbox"
              ? value(field.field_key) === "true"
              : field.kind === "multiselect"
                ? raw.split(",").filter(Boolean)
                : raw;
        if (field.target === "details") {
          details = String(parsed);
          continue;
        }
        payload[field.field_key] = parsed;
      }
    }
    if (hasDeclaration) payload.declaration_accepted = declaration;

    const amount = value("amount_kwd").trim();
    const result = await create.mutateAsync({
      driverId,
      type,
      payload,
      amountKwd: hasAmount && amount ? Number(amount) : null,
      startDate: hasDates ? value("start_date") || null : null,
      endDate: hasDates ? value("end_date") || null : null,
      severity: hasSeverity ? value("severity") || null : null,
      details,
    });

    if (!result.ok) {
      toast.error(t(`create.errors.${result.error ?? "failed"}` as "create.errors.failed"));
      return;
    }
    toast.success(t("create.success", { code: result.requestCode ?? "" }));
    reset();
    onOpenChange(false);
  };

  const fieldLabel = (key: string) => t(`create.fields.${key}` as "create.fields.comment");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="w-[min(760px,96vw)] max-w-[min(760px,96vw)] overflow-visible pt-4"
        showCloseButton
        closeOutside
      >
        <div className="space-y-3 px-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>
                {t("create.fieldRider")} <span className="text-destructive">*</span>
              </Label>
              <SearchSelect
                items={driverItems}
                value={driverId}
                onChange={setDriverId}
                placeholder={isLoading ? t("create.loading") : t("create.riderPlaceholder")}
                searchPlaceholder={t("create.riderSearchPlaceholder")}
                emptyText={t("create.riderEmpty")}
                recentsKey="requests-create-rider"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-1">
              <Label>
                {t("create.fieldType")} <span className="text-destructive">*</span>
              </Label>
              <SearchSelect
                items={typeItems}
                value={type}
                onChange={(next) => {
                  if (!next) return;
                  setType(next);
                  setDraft({});
                  setDeclaration(false);
                }}
                placeholder={isLoading ? t("create.loading") : t("create.fieldType")}
                searchPlaceholder={t("create.typeSearchPlaceholder")}
                emptyText={t("create.typeEmpty")}
                recentsKey="requests-create-type"
                disabled={isLoading}
                clearable={false}
              />
            </div>
          </div>

          {blocked ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{t(`create.gated.${blocked}` as "create.gated.tenure")}</span>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            {hasDates ? (
              <>
                <div className="space-y-1">
                  <Label>
                    {fieldLabel("start_date")} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="date"
                    className="h-9"
                    value={value("start_date")}
                    onChange={(e) => set("start_date", e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>
                    {fieldLabel("end_date")} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="date"
                    className="h-9"
                    min={value("start_date") || undefined}
                    value={value("end_date")}
                    onChange={(e) => set("end_date", e.target.value)}
                  />
                </div>
              </>
            ) : null}

            {hasAmount ? (
              <div className="space-y-1">
                <Label>{fieldLabel("amount_kwd")}</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.001"
                  className="h-9 tabular-nums"
                  value={value("amount_kwd")}
                  onChange={(e) => set("amount_kwd", e.target.value)}
                />
              </div>
            ) : null}

            {hasSeverity ? (
              <div className="space-y-1">
                <Label>{fieldLabel("severity")}</Label>
                <Select
                  items={SEVERITIES.map((key) => ({
                    value: key,
                    label: t(`create.severities.${key}` as "create.severities.low"),
                  }))}
                  value={value("severity")}
                  onValueChange={(next) => set("severity", next ?? "")}
                >
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue placeholder={fieldLabel("severity")} />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITIES.map((key) => (
                      <SelectItem
                        key={key}
                        value={key}
                        label={t(`create.severities.${key}` as "create.severities.low")}
                      >
                        {t(`create.severities.${key}` as "create.severities.low")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {payloadFields.map((field) => {
              const key = field.key;

              if (key === "tenure_months") {
                return (
                  <div key={key} className="space-y-1">
                    <Label>{fieldLabel(key)}</Label>
                    <Select
                      items={(options?.loanTenures ?? []).map((option) => ({
                        value: String(option.months),
                        label: option.label,
                      }))}
                      value={value(key)}
                      onValueChange={(next) => set(key, next ?? "")}
                    >
                      <SelectTrigger
                        className="h-9 w-full"
                        disabled={(options?.loanTenures.length ?? 0) === 0}
                      >
                        <SelectValue placeholder={t("create.gated.tenureShort")} />
                      </SelectTrigger>
                      <SelectContent>
                        {(options?.loanTenures ?? []).map((option) => (
                          <SelectItem
                            key={option.months}
                            value={String(option.months)}
                            label={option.label}
                          >
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              }

              if (key === "category") {
                return (
                  <div key={key} className="space-y-1">
                    <Label>{fieldLabel(key)}</Label>
                    <Select
                      items={(options?.complaintCategories ?? []).map((option) => ({
                        value: option.key,
                        label: option.label,
                      }))}
                      value={value(key)}
                      onValueChange={(next) => set(key, next ?? "")}
                    >
                      <SelectTrigger
                        className="h-9 w-full"
                        disabled={(options?.complaintCategories.length ?? 0) === 0}
                      >
                        <SelectValue placeholder={t("create.gated.categoryShort")} />
                      </SelectTrigger>
                      <SelectContent>
                        {(options?.complaintCategories ?? []).map((option) => (
                          <SelectItem
                            key={option.key}
                            value={option.key}
                            label={option.label}
                          >
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              }

              if (LONG_TEXT_KEYS.has(key)) {
                return (
                  <div key={key} className="space-y-1 sm:col-span-2">
                    <Label>{fieldLabel(key)}</Label>
                    <Textarea
                      rows={2}
                      value={value(key)}
                      onChange={(e) => set(key, e.target.value)}
                    />
                  </div>
                );
              }

              return (
                <div key={key} className="space-y-1">
                  <Label>{fieldLabel(key)}</Label>
                  <Input
                    className="h-9"
                    type={
                      NUMBER_KEYS.has(key)
                        ? "number"
                        : MONTH_KEYS.has(key)
                          ? "month"
                          : DATE_KEYS.has(key)
                            ? "date"
                            : "text"
                    }
                    min={NUMBER_KEYS.has(key) ? 0 : undefined}
                    value={value(key)}
                    onChange={(e) => set(key, e.target.value)}
                    placeholder={TEXT_KEYS.has(key) ? t("create.asRiderStated") : undefined}
                  />
                </div>
              );
            })}

            {!isTyped
              ? extraDynamic.map((field) => {
                  const key = field.field_key;
                  const label = (
                    <>
                      {fieldLabelFor(t, locale, field)}
                      {field.is_required ? (
                        <span className="text-destructive"> *</span>
                      ) : null}
                    </>
                  );
                  const selectOpts =
                    field.options_source === "loan_tenure_options"
                      ? (options?.loanTenures ?? []).map((option) => ({
                          value: String(option.months),
                          label: option.label,
                        }))
                      : field.options_source === "complaint_categories"
                        ? (options?.complaintCategories ?? []).map((option) => ({
                            value: option.key,
                            label: option.label,
                          }))
                        : field.options.map((option) => ({ value: option, label: option }));

                  if (field.kind === "checkbox") {
                    return (
                      <label key={key} className="flex items-start gap-2 sm:col-span-2">
                        <Checkbox
                          checked={value(key) === "true"}
                          onCheckedChange={(checked) =>
                            set(key, checked === true ? "true" : "")
                          }
                        />
                        <span className="text-[11px] text-muted-foreground">{label}</span>
                      </label>
                    );
                  }

                  if (field.kind === "select" || field.kind === "multiselect") {
                    return (
                      <div key={key} className="space-y-1">
                        <Label>{label}</Label>
                        <Select
                          items={selectOpts}
                          value={value(key)}
                          onValueChange={(next) => set(key, next ?? "")}
                        >
                          <SelectTrigger className="h-9 w-full" disabled={selectOpts.length === 0}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {selectOpts.map((option) => (
                              <SelectItem key={option.value} value={option.value} label={option.label}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  }

                  if (field.kind === "textarea" || field.target === "details") {
                    return (
                      <div key={key} className="space-y-1 sm:col-span-2">
                        <Label>{label}</Label>
                        <Textarea
                          rows={2}
                          value={value(key)}
                          onChange={(e) => set(key, e.target.value)}
                        />
                      </div>
                    );
                  }

                  return (
                    <div key={key} className="space-y-1">
                      <Label>{label}</Label>
                      <Input
                        className="h-9"
                        type={
                          field.kind === "number"
                            ? "number"
                            : field.kind === "month"
                              ? "month"
                              : field.kind === "date"
                                ? "date"
                                : "text"
                        }
                        value={value(key)}
                        onChange={(e) => set(key, e.target.value)}
                        placeholder={
                          field.kind === "text" || field.kind === "textarea"
                            ? t("create.asRiderStated")
                            : undefined
                        }
                      />
                    </div>
                  );
                })
              : null}

            {hasDeclaration ? (
              <label className="flex items-start gap-2 sm:col-span-2">
                <Checkbox
                  checked={declaration}
                  onCheckedChange={(checked) => setDeclaration(checked === true)}
                />
                <span className="text-[11px] text-muted-foreground">
                  {t("create.declaration")}
                </span>
              </label>
            ) : null}
          </div>
        </div>

        <div className="px-2 pb-2 pt-3">
          <AppModalFooter
            title={t("create.title")}
            subtitle={t("create.subtitle")}
            meta={t("create.onBehalfHint")}
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={create.isPending}
              onClick={() => onOpenChange(false)}
            >
              {t("create.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9"
              disabled={Boolean(blocked) || missingRequired || create.isPending}
              onClick={() => void submit()}
            >
              {create.isPending ? (
                <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="me-1.5 h-3.5 w-3.5" />
              )}
              {t("create.submit")}
            </Button>
          </AppModalFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
