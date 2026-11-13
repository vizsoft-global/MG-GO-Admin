"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCustomFieldDefinitions } from "@/features/custom-fields/use-custom-fields";
import type { CustomChartDef, CustomColumnDef, OperationsHubConfig } from "@/features/operations-dashboard/shape";
import { DRIVER_ENTITY_TYPE, customFieldColumnId } from "@/lib/custom-fields/types";
import {
  isBaseRosterField,
  materialiseRosterColumns,
  moveRosterColumn,
  newRosterCustomColumn,
} from "./custom-columns";
import { rosterBaseHeading } from "./custom-columns-labels";

type SaveState = "idle" | "saving" | "saved" | "error";

const CHART_DIMENSIONS = ["nationalityCategory", "nationalityCountry", "status", "project", "zone"] as const;

/**
 * Custom columns for the Rider Operations roster.
 *
 * **Autosave, no Save button.** Every action — rename, move, hide, add, remove —
 * writes the whole definition through `onSave` and reports the outcome in the
 * footer, because a configuration the operator has to remember to commit is one
 * they will leave half-applied. The dialog stays open so the next change is one
 * click away, and the table behind it repaints from the same state.
 *
 * It is **remounted on every open** (`key` at the call site) rather than reset by
 * an effect: the definition is the initial value of the list, and a fresh mount
 * is the one way to re-read it without a cascading render.
 *
 * The list is the **materialised plan**, not the stored array: a base field the
 * stored definition never mentioned still has a row here, which is what makes it
 * movable and hideable. Removing a base field therefore means hiding it —
 * deleting it from the document would only bring it back from the catalogue.
 */
export function CustomColumnsDialog({
  open,
  onOpenChange,
  config,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: OperationsHubConfig;
  onSave: (next: OperationsHubConfig) => Promise<boolean>;
}) {
  const t = useTranslations("pages.operationsDashboardV2");
  const { data: definitions = [] } = useCustomFieldDefinitions(DRIVER_ENTITY_TYPE);
  const activeDefinitions = useMemo(() => definitions.filter((definition) => definition.is_active), [definitions]);

  const [tab, setTab] = useState<"columns" | "charts">("columns");
  const [columns, setColumns] = useState<CustomColumnDef[]>(() =>
    materialiseRosterColumns(config.customColumns, { includePhone: true }),
  );
  const [charts, setCharts] = useState<CustomChartDef[]>(config.customCharts);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftField, setDraftField] = useState("");

  const [newField, setNewField] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newChartTitle, setNewChartTitle] = useState("");
  const [newChartType, setNewChartType] = useState<CustomChartDef["type"]>("donut");
  const [newChartDim, setNewChartDim] = useState<CustomChartDef["dimension"]>("nationalityCategory");

  const persist = useCallback(
    async (nextColumns: CustomColumnDef[], nextCharts: CustomChartDef[]) => {
      setColumns(nextColumns);
      setCharts(nextCharts);
      setSaveState("saving");
      const ok = await onSave({ customColumns: nextColumns, customCharts: nextCharts });
      setSaveState(ok ? "saved" : "error");
    },
    [onSave],
  );

  const usedFields = useMemo(() => new Set(columns.map((column) => column.field)), [columns]);
  const availableFields = useMemo(
    () => activeDefinitions.filter((definition) => !usedFields.has(definition.key)),
    [activeDefinitions, usedFields],
  );
  /** The select always shows a real heading: an empty value has no label to render. */
  const addField = newField || availableFields[0]?.key || "";

  const columnLabel = (column: CustomColumnDef): string => {
    if (isBaseRosterField(column.field)) {
      return (column.customLabel ?? "").trim() || rosterBaseHeading(column.field, t);
    }
    return (column.label ?? "").trim() || column.field;
  };

  const toggleColumn = (id: string) => {
    const next = columns.map((column) =>
      column.id === id ? { ...column, visible: column.visible === false } : column,
    );
    void persist(next, charts);
  };

  const moveColumn = (id: string, dir: -1 | 1) => {
    void persist(moveRosterColumn(columns, id, dir), charts);
  };

  const removeColumn = (id: string) => {
    void persist(
      columns.filter((column) => column.id !== id),
      charts,
    );
  };

  const startEdit = (column: CustomColumnDef) => {
    setEditingId(column.id);
    setDraftLabel(isBaseRosterField(column.field) ? (column.customLabel ?? "") : column.label);
    setDraftField(column.field);
  };

  const commitEdit = () => {
    if (!editingId) return;
    const current = columns.find((column) => column.id === editingId);
    if (!current) return;
    if (isBaseRosterField(current.field)) {
      const next = columns.map((column) =>
        column.id === editingId ? { ...column, customLabel: draftLabel.trim() } : column,
      );
      setEditingId(null);
      void persist(next, charts);
      return;
    }
    const field = draftField.trim();
    if (!field) return;
    if (columns.some((column) => column.id !== editingId && column.field === field)) {
      toast.error(t("customize.duplicateField"));
      return;
    }
    const replacement: CustomColumnDef = {
      id: customFieldColumnId(field),
      field,
      label: draftLabel.trim() || field,
      visible: current.visible !== false,
    };
    const next = columns.map((column) => (column.id === editingId ? replacement : column));
    setEditingId(null);
    void persist(next, charts);
  };

  const addColumn = () => {
    if (!addField) return;
    if (usedFields.has(addField)) {
      toast.error(t("customize.duplicateField"));
      return;
    }
    setNewField("");
    setNewLabel("");
    void persist([...columns, newRosterCustomColumn(addField, newLabel)], charts);
  };

  const addChart = () => {
    if (!newChartTitle.trim()) return;
    const next = [
      ...charts,
      {
        id: `chart_${Date.now()}`,
        title: newChartTitle.trim(),
        type: newChartType,
        dimension: newChartDim,
      },
    ];
    setNewChartTitle("");
    void persist(columns, next);
  };

  const removeChart = (id: string) => {
    void persist(
      columns,
      charts.filter((chart) => chart.id !== id),
    );
  };

  const savedMeta =
    saveState === "saving" ? (
      <span className="text-xs text-muted-foreground">{t("customize.saving")}</span>
    ) : saveState === "saved" ? (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
        <Check className="size-3.5" aria-hidden />
        {t("customize.saved")}
      </span>
    ) : saveState === "error" ? (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <TriangleAlert className="size-3.5" aria-hidden />
        {t("customize.saveFailed")}
      </span>
    ) : (
      <span className="text-xs text-muted-foreground">{t("customize.autosave")}</span>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeOutside showCloseButton className="w-[min(720px,96vw)] max-w-none">
        <div className="space-y-3 px-5 pt-4">
          <div className="flex gap-1 rounded-lg bg-muted/40 p-1">
            {(
              [
                ["columns", t("customize.tabColumns", { count: columns.length })],
                ["charts", t("customize.tabCharts", { count: charts.length })],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`h-8 flex-1 cursor-pointer rounded-md text-xs font-semibold transition-colors ${
                  tab === key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "columns" ? (
            <div className="space-y-3">
              <div className="max-h-[min(430px,calc(100dvh-320px))] space-y-1.5 overflow-y-auto pe-1">
                {columns.map((column, index) => {
                  const editing = editingId === column.id;
                  const baseField = isBaseRosterField(column.field) ? column.field : null;
                  const hidden = column.visible === false;
                  return (
                    <div
                      key={column.id}
                      className={`rounded-lg border px-2 py-1.5 ${
                        hidden ? "border-border bg-muted/30" : "border-border bg-card"
                      }`}
                    >
                      {editing ? (
                        <div className="space-y-1.5">
                          <Input
                            autoFocus
                            value={draftLabel}
                            onChange={(event) => setDraftLabel(event.target.value)}
                            placeholder={
                              baseField ? rosterBaseHeading(baseField, t) : t("customize.labelPlaceholder")
                            }
                            className="h-8 text-xs"
                          />
                          {baseField ? null : (
                            <Select
                              items={activeDefinitions.map((definition) => ({
                                value: definition.key,
                                label: definition.label,
                              }))}
                              value={draftField}
                              onValueChange={(value) => setDraftField(value ?? "")}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {activeDefinitions.map((definition) => (
                                  <SelectItem key={definition.key} value={definition.key}>
                                    {definition.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                          <div className="flex justify-end gap-1.5">
                            <Button
                              type="button"
                              variant="portal-neutral"
                              size="sm"
                              className="h-7 cursor-pointer px-2 text-xs"
                              onClick={() => setEditingId(null)}
                            >
                              {t("cancel")}
                            </Button>
                            <Button
                              type="button"
                              variant="portal"
                              size="sm"
                              className="h-7 cursor-pointer px-2 text-xs"
                              onClick={commitEdit}
                            >
                              {t("customize.done")}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="flex shrink-0 flex-col">
                            <button
                              type="button"
                              aria-label={t("customize.moveUp")}
                              title={t("customize.moveUp")}
                              disabled={index === 0}
                              onClick={() => moveColumn(column.id, -1)}
                              className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              <ArrowUp className="size-3" aria-hidden />
                            </button>
                            <button
                              type="button"
                              aria-label={t("customize.moveDown")}
                              title={t("customize.moveDown")}
                              disabled={index === columns.length - 1}
                              onClick={() => moveColumn(column.id, 1)}
                              className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              <ArrowDown className="size-3" aria-hidden />
                            </button>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-foreground">{columnLabel(column)}</p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {baseField ? t("customize.builtInField") : t("customize.customField")}
                              {" · "}
                              <code className="font-mono text-[10px]">{column.field}</code>
                            </p>
                          </div>
                          <button
                            type="button"
                            aria-label={hidden ? t("customize.show") : t("customize.hide")}
                            title={hidden ? t("customize.show") : t("customize.hide")}
                            onClick={() => toggleColumn(column.id)}
                            className={`shrink-0 cursor-pointer rounded border p-1 ${
                              hidden
                                ? "border-border text-muted-foreground hover:bg-muted"
                                : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            }`}
                          >
                            {hidden ? (
                              <EyeOff className="size-3.5" aria-hidden />
                            ) : (
                              <Eye className="size-3.5" aria-hidden />
                            )}
                          </button>
                          <button
                            type="button"
                            aria-label={t("customize.edit")}
                            title={t("customize.edit")}
                            onClick={() => startEdit(column)}
                            className="shrink-0 cursor-pointer rounded p-1 text-primary hover:bg-primary/10"
                          >
                            <Pencil className="size-3.5" aria-hidden />
                          </button>
                          {baseField ? null : (
                            <button
                              type="button"
                              aria-label={t("customize.remove")}
                              title={t("customize.remove")}
                              onClick={() => removeColumn(column.id)}
                              className="shrink-0 cursor-pointer rounded p-1 text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="size-3.5" aria-hidden />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-xs font-semibold text-foreground">{t("customize.addHeading")}</p>
                {activeDefinitions.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">{t("customize.noDefinitions")}</p>
                ) : availableFields.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">{t("customize.allFieldsUsed")}</p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <Select
                      items={availableFields.map((definition) => ({
                        value: definition.key,
                        label: definition.label,
                      }))}
                      value={addField}
                      onValueChange={(value) => setNewField(value ?? "")}
                    >
                      <SelectTrigger className="h-9 text-xs" aria-label={t("customize.fieldLabel")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availableFields.map((definition) => (
                          <SelectItem key={definition.key} value={definition.key}>
                            {definition.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={newLabel}
                      onChange={(event) => setNewLabel(event.target.value)}
                      placeholder={t("customize.labelPlaceholder")}
                      className="h-9 text-xs"
                    />
                    <Button
                      type="button"
                      variant="portal"
                      className="h-9 cursor-pointer"
                      disabled={!addField}
                      onClick={addColumn}
                    >
                      <Plus className="me-1 size-3.5" aria-hidden />
                      {t("customize.add")}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="max-h-[min(430px,calc(100dvh-320px))] space-y-1.5 overflow-y-auto pe-1">
                {charts.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">{t("customize.noCharts")}</p>
                ) : (
                  charts.map((chart) => (
                    <div
                      key={chart.id}
                      className="flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-foreground">{chart.title}</p>
                        <p className="truncate text-[11px] capitalize text-muted-foreground">
                          {chart.type} · {chart.dimension}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label={t("customize.remove")}
                        title={t("customize.remove")}
                        onClick={() => removeChart(chart.id)}
                        className="shrink-0 cursor-pointer rounded p-1 text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-xs font-semibold text-foreground">{t("customize.addChartHeading")}</p>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                  <Input
                    value={newChartTitle}
                    onChange={(event) => setNewChartTitle(event.target.value)}
                    placeholder={t("customize.chartTitlePlaceholder")}
                    className="h-9 text-xs"
                  />
                  <Select
                    items={[
                      { value: "donut", label: t("customize.chartDonut") },
                      { value: "bar", label: t("customize.chartBar") },
                      { value: "pie", label: t("customize.chartPie") },
                    ]}
                    value={newChartType}
                    onValueChange={(value) => setNewChartType(value as CustomChartDef["type"])}
                  >
                    <SelectTrigger className="h-9 text-xs" aria-label={t("customize.chartType")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="donut">{t("customize.chartDonut")}</SelectItem>
                      <SelectItem value="bar">{t("customize.chartBar")}</SelectItem>
                      <SelectItem value="pie">{t("customize.chartPie")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    items={CHART_DIMENSIONS.map((dimension) => ({
                      value: dimension,
                      label: dimension,
                    }))}
                    value={newChartDim}
                    onValueChange={(value) => setNewChartDim(value as CustomChartDef["dimension"])}
                  >
                    <SelectTrigger className="h-9 text-xs" aria-label={t("customize.chartDimension")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHART_DIMENSIONS.map((dimension) => (
                        <SelectItem key={dimension} value={dimension}>
                          {dimension}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="portal"
                    className="h-9 cursor-pointer"
                    disabled={!newChartTitle.trim()}
                    onClick={addChart}
                  >
                    <Plus className="me-1 size-3.5" aria-hidden />
                    {t("customize.addChart")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 pb-4 pt-3">
          <AppModalFooter title={t("customize.title")} subtitle={t("customize.subtitle")} meta={savedMeta}>
            <Button variant="portal" className="h-9 cursor-pointer" onClick={() => onOpenChange(false)}>
              {t("customize.close")}
            </Button>
          </AppModalFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
