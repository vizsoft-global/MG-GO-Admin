"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Loader2,
  Lock,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { selectOptions } from "@/lib/select-items";
import {
  deleteRequestType,
  fetchRequestFieldDefinitions,
  fetchRequestTypeDefinitions,
  saveRequestFieldDefinitions,
} from "./request-type-builder-actions";
import { RequestTypeFormDialog } from "./request-type-form-dialog";
import {
  REQUEST_FIELD_KINDS,
  REQUEST_FIELD_TARGETS,
  REQUEST_TYPE_ERROR_CODES,
  type RequestFieldDefinitionRow,
  type RequestFieldKind,
  type RequestFieldOptionSource,
  type RequestFieldTarget,
  type RequestTypeDefinitionRow,
} from "./settings-types";

/** Kinds whose value the rider picks from a list rather than types. */
const CHOICE_KINDS = new Set<RequestFieldKind>(["select", "multiselect"]);

function emptyField(order: number): RequestFieldDefinitionRow {
  return {
    field_key: "",
    label_en: "",
    label_ar: null,
    kind: "text",
    target: "payload",
    is_required: false,
    is_server_required: false,
    sort_order: order,
    options_source: null,
    options: [],
    help_en: null,
  };
}

export function RequestTypeDetailShell({ typeKey }: { typeKey: string }) {
  const t = useTranslations("pages.requests.settings.types");
  const tRoot = useTranslations("pages.requests");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const editOpen = searchParams.get("edit") === "1";

  const [definition, setDefinition] = useState<RequestTypeDefinitionRow | null>(null);
  const [fields, setFields] = useState<RequestFieldDefinitionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [isPending, startTransition] = useTransition();

  const errorMessage = useCallback(
    (code?: string) =>
      code && REQUEST_TYPE_ERROR_CODES.has(code)
        ? t(`errors.${code}` as "errors.saveFailed")
        : (code ?? t("errors.saveFailed")),
    [t],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const [defs, fieldResult] = await Promise.all([
      fetchRequestTypeDefinitions(),
      fetchRequestFieldDefinitions(typeKey),
    ]);
    setLoading(false);
    if (defs.error) {
      toast.error(defs.error);
      return;
    }
    setDefinition(defs.rows.find((row) => row.key === typeKey) ?? null);
    setFields(fieldResult.rows);
    setDirty(false);
  }, [typeKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const locked = definition?.is_system ?? true;

  function updateField(index: number, patch: Partial<RequestFieldDefinitionRow>) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
    setDirty(true);
  }

  function moveField(index: number, direction: -1 | 1) {
    setFields((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((f, i) => ({ ...f, sort_order: i + 1 }));
    });
    setDirty(true);
  }

  function handleSaveFields() {
    startTransition(async () => {
      const result = await saveRequestFieldDefinitions(typeKey, fields);
      if (!result.ok) {
        toast.error(errorMessage(result.error));
        return;
      }
      toast.success(t("fieldsSaved"));
      await load();
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteRequestType(typeKey);
      if (!result.ok) {
        toast.error(errorMessage(result.error));
        return;
      }
      toast.success(t("deleted"));
      router.replace("/requests/settings/types");
    });
  }

  if (loading) {
    return (
      <AppPage>
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="me-2 h-4 w-4 animate-spin" />
          {t("loading")}
        </div>
      </AppPage>
    );
  }

  if (!definition) {
    return (
      <AppPage>
        <AppListCard className="p-8 text-center text-sm text-muted-foreground">
          {t("notFound")}
        </AppListCard>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <AppPageHeader
        title={definition.label_en}
        description={t("detailSubtitle", { key: definition.key })}
        breadcrumbs={[
          { label: tRoot("title"), href: "/requests" },
          { label: t("hub"), href: "/requests/settings" },
          { label: t("title"), href: "/requests/settings/types" },
          { label: definition.label_en },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => router.replace(`${pathname}?edit=1`)}
            >
              {t("edit")}
            </Button>
            {definition.is_system ? null : (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-destructive hover:bg-destructive/10"
                disabled={isPending || definition.request_count > 0}
                title={definition.request_count > 0 ? t("errors.type_in_use") : undefined}
                onClick={handleDelete}
              >
                <Trash2 className="me-1.5 h-3.5 w-3.5" />
                {t("delete")}
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-2 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
        <AppListCard className="space-y-2 p-4">
          <h3 className="text-sm font-semibold">{t("summaryTitle")}</h3>
          <dl className="space-y-1.5 text-xs">
            <SummaryRow label={t("fieldKey")} value={<code>{definition.key}</code>} />
            <SummaryRow
              label={t("fieldTerminalStatus")}
              value={
                definition.terminal_status_on_approve === "solved"
                  ? t("terminalSolved")
                  : t("terminalApproved")
              }
            />
            <SummaryRow
              label={t("toggleAck")}
              value={definition.requires_driver_ack_on_approve ? t("yes") : t("no")}
            />
            <SummaryRow
              label={t("toggleDateRange")}
              value={definition.date_range_required ? t("yes") : t("no")}
            />
            <SummaryRow
              label={t("fieldMinAttachments")}
              value={String(definition.min_attachments)}
            />
            <SummaryRow
              label={t("colChain")}
              value={
                definition.step_count > 0
                  ? t("stepsCount", { count: definition.step_count })
                  : t("noChain")
              }
            />
          </dl>
          <div className="flex flex-col gap-1 pt-1">
            <Link
              href="/requests/settings/workflows"
              className="text-[11px] font-medium text-primary hover:underline"
            >
              {t("editChain")}
            </Link>
            {/* The two DB-backed option lists belong to the type that consumes them. */}
            {definition.key === "loan" ? (
              <Link
                href="/requests/settings/tenure"
                className="text-[11px] font-medium text-primary hover:underline"
              >
                {t("manageTenure")}
              </Link>
            ) : null}
            {definition.key === "complaint" ? (
              <Link
                href="/requests/settings/categories"
                className="text-[11px] font-medium text-primary hover:underline"
              >
                {t("manageCategories")}
              </Link>
            ) : null}
          </div>
          {definition.is_system ? (
            <p className="flex gap-1.5 border-t border-border pt-2 text-[10px] text-muted-foreground">
              <Lock className="mt-px h-3 w-3 shrink-0" />
              {t("systemLockNote")}
            </p>
          ) : null}
        </AppListCard>

        <AppListCard className="space-y-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t("fieldsTitle")}</h3>
            <div className="flex items-center gap-2">
              {dirty ? (
                <span className="rounded-full border border-warning-bg bg-warning-bg px-2 py-0.5 text-[11px] font-medium text-warning">
                  {t("unsavedChanges")}
                </span>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={locked}
                onClick={() => {
                  setFields((prev) => [...prev, emptyField(prev.length + 1)]);
                  setDirty(true);
                }}
              >
                <Plus className="me-1 h-3.5 w-3.5" />
                {t("addField")}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8"
                disabled={locked || isPending || !dirty}
                onClick={handleSaveFields}
              >
                {isPending ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                {t("save")}
              </Button>
            </div>
          </div>

          {fields.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">{t("noFields")}</p>
          ) : (
            <div className="space-y-1.5">
              {fields.map((field, index) => (
                <FieldRow
                  key={`${field.id ?? "new"}-${index}`}
                  field={field}
                  index={index}
                  total={fields.length}
                  locked={locked}
                  onChange={(patch) => updateField(index, patch)}
                  onMove={(dir) => moveField(index, dir)}
                  onRemove={() => {
                    setFields((prev) => prev.filter((_, i) => i !== index));
                    setDirty(true);
                  }}
                />
              ))}
            </div>
          )}
        </AppListCard>
      </div>

      <RequestTypeFormDialog
        open={editOpen}
        onOpenChange={(open) => router.replace(open ? `${pathname}?edit=1` : pathname)}
        existing={definition}
        nextSortOrder={definition.sort_order}
        onSaved={load}
      />
    </AppPage>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function FieldRow({
  field,
  index,
  total,
  locked,
  onChange,
  onMove,
  onRemove,
}: {
  field: RequestFieldDefinitionRow;
  index: number;
  total: number;
  locked: boolean;
  onChange: (patch: Partial<RequestFieldDefinitionRow>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("pages.requests.settings.types");
  const isChoice = CHOICE_KINDS.has(field.kind);

  const kindOptions = REQUEST_FIELD_KINDS.map((kind) => ({
    value: kind,
    label: t(`kinds.${kind}` as "kinds.text"),
  }));
  const targetOptions = REQUEST_FIELD_TARGETS.map((target) => ({
    value: target,
    label: t(`targets.${target}` as "targets.payload"),
  }));
  const sourceOptions = [
    { value: "static", label: t("optionSourceStatic") },
    { value: "loan_tenure_options", label: t("optionSourceTenure") },
    { value: "complaint_categories", label: t("optionSourceCategories") },
  ];

  return (
    <div className="rounded-xl border border-border bg-background p-2.5">
      <div className="flex flex-wrap items-end gap-2">
        <span className="mb-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
          {index + 1}
        </span>

        <div className="min-w-[150px] flex-1 space-y-1">
          <Label className="text-[10px]">{t("fieldLabelEn")}</Label>
          <Input
            className="h-9"
            value={field.label_en}
            disabled={locked}
            onChange={(e) => onChange({ label_en: e.target.value })}
          />
        </div>

        <div className="w-[150px] space-y-1">
          <Label className="text-[10px]">{t("fieldKey")}</Label>
          <Input
            className="h-9 font-mono text-xs"
            value={field.field_key}
            disabled={locked}
            onChange={(e) => onChange({ field_key: e.target.value.trim() })}
          />
        </div>

        <div className="w-[130px] space-y-1">
          <Label className="text-[10px]">{t("fieldKind")}</Label>
          <Select
            value={field.kind}
            disabled={locked}
            onValueChange={(v) =>
              v &&
              onChange({
                kind: v as RequestFieldKind,
                options_source: CHOICE_KINDS.has(v as RequestFieldKind)
                  ? (field.options_source ?? "static")
                  : null,
              })
            }
            items={selectOptions(kindOptions)}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {kindOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-[140px] space-y-1">
          <Label className="text-[10px]">{t("fieldTarget")}</Label>
          <Select
            value={field.target}
            disabled={locked}
            onValueChange={(v) => v && onChange({ target: v as RequestFieldTarget })}
            items={selectOptions(targetOptions)}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {targetOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mb-1.5 flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={locked || index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={locked || index === total - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:bg-destructive/10"
            disabled={locked}
            onClick={onRemove}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 ps-8">
        <label className="flex items-center gap-1.5 text-[11px]">
          <Switch
            checked={field.is_required}
            disabled={locked}
            onCheckedChange={(v) =>
              onChange({ is_required: v, is_server_required: v && field.is_server_required })
            }
          />
          {t("toggleRequired")}
        </label>
        <label className="flex items-center gap-1.5 text-[11px]">
          <Switch
            checked={field.is_server_required}
            disabled={locked || !field.is_required}
            onCheckedChange={(v) => onChange({ is_server_required: v })}
          />
          <span className={!field.is_required ? "text-muted-foreground" : undefined}>
            {t("toggleServerRequired")}
          </span>
        </label>

        {isChoice ? (
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="w-[170px]">
              <Select
                value={field.options_source ?? "static"}
                disabled={locked}
                onValueChange={(v) =>
                  v && onChange({ options_source: v as RequestFieldOptionSource })
                }
                items={selectOptions(sourceOptions)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sourceOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {field.options_source === "static" ? (
              <Textarea
                className="min-h-9 flex-1 py-2 text-xs"
                rows={1}
                placeholder={t("optionsPlaceholder")}
                disabled={locked}
                value={field.options.join("\n")}
                onChange={(e) => onChange({ options: e.target.value.split("\n") })}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {field.is_server_required ? (
        <p className="mt-1 ps-8 text-[10px] text-muted-foreground">
          {t("serverRequiredHint")}
        </p>
      ) : null}
    </div>
  );
}
