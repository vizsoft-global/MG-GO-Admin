"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Filter,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { MultiCombobox } from "@/components/multi-combobox";
import { SearchSelect } from "@/components/ui/search-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/auth-context";
import { purgeBlockerLabel } from "./purge-blockers";
import { purgeAllModuleFor } from "./purge-entities";
import {
  countPurgeFilters,
  describePurgeFilter,
  formatPurgeDate,
  isPurgeDateRangeColumn,
  isPurgeFilterEntity,
  parsePurgeDate,
  purgeColumnOffersValues,
  purgeFilterColumnLabel,
  purgeFilterValueLabel,
  sanitisePurgeFilters,
  type PurgeFilterColumn,
  type PurgeFilterValue,
  type PurgeFilters,
} from "./purge-filter-catalog";
import {
  usePurgeFilterColumns,
  usePurgeFilteredPage,
  usePurgeFilteredPreview,
  usePurgeFilteredRun,
  usePurgeFilterValues,
} from "./use-purge-filters";

/**
 * Clear by filter — the narrower sibling of Clear all.
 *
 * The dialog composes a filter set one column at a time, then reads the matched
 * rows back from the server before offering a delete. Nothing is matched
 * client-side: the count, the review list, the blockers and the deleted ids all
 * come from the same `admin_purge_matched_rows` call, so what the operator
 * counts on screen is what the delete acts on.
 *
 * Clear all is untouched. This deletes a subset with the same per-id purgers,
 * so storage and Auth-user cleanup cannot drift between the two entry points.
 */

/** Rows per review page — small enough that the list never dominates the modal. */
const REVIEW_PAGE_SIZE = 8;

type Draft = {
  column: string | null;
  values: string[];
  text: string;
  min: string;
  max: string;
};

const EMPTY_DRAFT: Draft = { column: null, values: [], text: "", min: "", max: "" };

/** A draft is a filter only once it carries a value of the column's own kind. */
function draftToValue(
  column: PurgeFilterColumn,
  draft: Draft,
): PurgeFilterValue | null {
  if (column.kind === "list") {
    return draft.values.length > 0 ? { in: draft.values } : null;
  }
  if (column.kind === "text") {
    const contains = draft.text.trim();
    return contains ? { contains } : null;
  }

  const isDate = isPurgeDateRangeColumn(column);
  const parse = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (isDate) return parsePurgeDate(trimmed);
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const min = parse(draft.min);
  const max = parse(draft.max);
  if (min === null && max === null) return null;
  return { ...(min === null ? {} : { min }), ...(max === null ? {} : { max }) };
}

/** The draft that reproduces an existing filter, so a chip reopens editable. */
function valueToDraft(column: PurgeFilterColumn, value: PurgeFilterValue): Draft {
  const draft: Draft = { ...EMPTY_DRAFT, column: column.key };
  if (column.kind === "list") {
    draft.values = (value as { in?: string[] }).in ?? [];
    return draft;
  }
  if (column.kind === "text") {
    draft.text = (value as { contains?: string }).contains ?? "";
    return draft;
  }
  const { min, max } = value as { min?: number; max?: number };
  const format = (n: number | undefined) =>
    n === undefined ? "" : isPurgeDateRangeColumn(column) ? formatPurgeDate(n) : String(n);
  draft.min = format(min);
  draft.max = format(max);
  return draft;
}

export function PurgeFilteredDialog({
  open,
  onOpenChange,
  entity,
  onFinished,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: string;
  onFinished?: () => void;
}) {
  const t = useTranslations("pages.settings.dataCleanup");
  /**
   * Column and value labels live in the `filtered` namespace, so the catalog
   * helpers take that translator — passing `t` would resolve `columns.status`
   * against the parent namespace and paint the key path instead of the word.
   */
  const tl = useTranslations("pages.settings.dataCleanup.filtered");
  const [filters, setFilters] = useState<PurgeFilters>({});
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [page, setPage] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const module_ = purgeAllModuleFor(entity);
  const moduleLabel = module_ ? t(`modules.${module_.entity}`) : entity;
  const noun = module_
    ? t(`clearAll.nouns.${module_.entity}`)
    : entity.replace(/_/g, " ").toUpperCase();

  const columnsQuery = usePurgeFilterColumns(open ? entity : null);
  const columns = useMemo<PurgeFilterColumn[]>(() => {
    return (columnsQuery.data ?? []).map((column) => ({
      key: column.key,
      kind:
        column.kind === "list" || column.kind === "range"
          ? column.kind
          : "text",
    }));
  }, [columnsQuery.data]);

  const active = useMemo(() => sanitisePurgeFilters(columns, filters), [columns, filters]);
  const activeCount = countPurgeFilters(active);

  const draftColumn = useMemo(
    () => columns.find((column) => column.key === draft.column) ?? null,
    [columns, draft.column],
  );

  // Facets honour every *other* filter, exactly as the drivers list popup does,
  // so a value that cannot match is never offered.
  const otherFilters = useMemo(() => {
    if (!draftColumn) return active;
    const rest = { ...active };
    delete rest[draftColumn.key];
    return rest;
  }, [active, draftColumn]);

  const valuesQuery = usePurgeFilterValues(
    open ? entity : null,
    draftColumn?.key ?? null,
    otherFilters,
    Boolean(draftColumn && purgeColumnOffersValues(draftColumn.kind)),
  );

  const preview = usePurgeFilteredPreview(entity, active, open);
  const count = preview.data?.count ?? 0;
  const blockers = preview.data?.blockers ?? [];

  const reviewQuery = usePurgeFilteredPage(
    entity,
    active,
    page,
    open && activeCount > 0 && count > 0,
  );

  const run = usePurgeFilteredRun();

  const resetDraft = useCallback(() => setDraft(EMPTY_DRAFT), []);

  const applyDraft = useCallback(() => {
    if (!draftColumn) return;
    const value = draftToValue(draftColumn, draft);
    if (!value) {
      toast.error(t("filtered.errors.emptyValue"));
      return;
    }
    setFilters((previous) => ({ ...previous, [draftColumn.key]: value }));
    setPage(1);
    resetDraft();
  }, [draft, draftColumn, resetDraft, t]);

  const removeFilter = useCallback((key: string) => {
    setFilters((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
    setPage(1);
  }, []);

  const handleRun = useCallback(async () => {
    try {
      const result = await run.mutateAsync({ entity, filters: active });
      if (result.warning) {
        toast.warning(
          t("clearAll.partial", { deleted: result.deleted, error: result.warning }),
        );
      } else if (result.done) {
        toast.success(t("filtered.success", { count: result.deleted }));
      } else {
        toast.warning(
          t("clearAll.remaining", { deleted: result.deleted, remaining: result.remaining }),
        );
      }
      setFilters({});
      setPage(1);
      setConfirmOpen(false);
      onFinished?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.purgeFailed"));
    }
  }, [active, entity, onFinished, run, t]);

  const rows = reviewQuery.data?.rows ?? [];
  const total = reviewQuery.data?.total ?? count;
  const totalPages = Math.max(1, Math.ceil(total / REVIEW_PAGE_SIZE));
  const noColumns = !columnsQuery.isLoading && columns.length === 0;
  const blocked = blockers.length > 0;
  const busy = preview.isFetching;

  const valueItems = useMemo(
    () =>
      (valuesQuery.data ?? [])
        .filter((facet) => facet.value !== "")
        .map((facet) => ({
          value: facet.value,
          label: purgeFilterValueLabel(tl, facet.value, facet.label),
          keywords: [facet.value, facet.label ?? ""],
        })),
    [tl, valuesQuery.data],
  );

  if (confirmOpen) {
    return (
      <ConfirmDeleteDialog
        open
        onOpenChange={(next) => {
          if (!next && !run.isPending) {
            setConfirmOpen(false);
            onOpenChange(false);
          }
        }}
        itemTitle={t("filtered.confirmTitle", { module: moduleLabel })}
        itemName={t("filtered.confirmItemName", { count, module: moduleLabel })}
        confirmText={t("filtered.confirmPhrase", { count, noun })}
        warning={t("filtered.warning")}
        onConfirm={handleRun}
        isPending={run.isPending}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex w-[min(960px,96vw)] flex-col gap-0 overflow-visible rounded-xl p-0"
        showCloseButton
        closeOutside
      >
        <div className="space-y-3 px-5 pt-4">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="font-medium text-amber-900 dark:text-amber-100">
                  {t("filtered.bannerTitle")}
                </p>
                <p className="mt-0.5 text-amber-800/90 dark:text-amber-200/90">
                  {t("filtered.bannerBody")}
                </p>
              </div>
            </div>
          </div>

          {/* Column + value composer. One filter at a time, applied explicitly,
              so the operator sees the value land before the count moves. */}
          <div className="rounded-xl border border-border p-3">
            {noColumns ? (
              <p className="py-2 text-center text-sm text-muted-foreground">
                {t("filtered.noColumns", { module: moduleLabel })}
              </p>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[180px] flex-1">
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                    {t("filtered.column")}
                  </p>
                  <Select
                    items={columns.map((column) => ({
                      value: column.key,
                      label: purgeFilterColumnLabel(tl, entity, column.key),
                    }))}
                    value={draft.column}
                    onValueChange={(value) =>
                      setDraft({ ...EMPTY_DRAFT, column: value ?? null })
                    }
                  >
                    <SelectTrigger className="h-9 w-full cursor-pointer rounded-lg">
                      <SelectValue
                        placeholder={
                          columnsQuery.isLoading
                            ? t("filtered.loadingColumns")
                            : t("filtered.columnPlaceholder")
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {columns.map((column) => (
                        <SelectItem
                          key={column.key}
                          value={column.key}
                          className="cursor-pointer"
                        >
                          {purgeFilterColumnLabel(tl, entity, column.key)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="min-w-[240px] flex-[2_1_320px]">
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                    {t("filtered.value")}
                  </p>
                  {draftColumn?.kind === "list" ? (
                    <MultiCombobox
                      items={valueItems}
                      value={draft.values}
                      onChange={(values) => setDraft((d) => ({ ...d, values }))}
                      placeholder={
                        valuesQuery.isLoading
                          ? t("filtered.loadingValues")
                          : t("filtered.valuePlaceholder")
                      }
                      searchPlaceholder={t("filtered.valueSearch")}
                      emptyText={t("filtered.noValues")}
                      selectAllLabel={t("filtered.selectAll")}
                      clearLabel={t("filtered.clear")}
                      selectedSummary={(n) => tl("valueCount", { count: n })}
                    />
                  ) : draftColumn?.kind === "range" ? (
                    <div className="flex items-center gap-2">
                      <Input
                        type={isPurgeDateRangeColumn(draftColumn) ? "date" : "number"}
                        value={draft.min}
                        onChange={(e) => setDraft((d) => ({ ...d, min: e.target.value }))}
                        placeholder={t("filtered.min")}
                        aria-label={t("filtered.min")}
                        className="h-9 rounded-lg"
                      />
                      <span className="text-xs text-muted-foreground">
                        {t("filtered.rangeSeparator")}
                      </span>
                      <Input
                        type={isPurgeDateRangeColumn(draftColumn) ? "date" : "number"}
                        value={draft.max}
                        onChange={(e) => setDraft((d) => ({ ...d, max: e.target.value }))}
                        placeholder={t("filtered.max")}
                        aria-label={t("filtered.max")}
                        className="h-9 rounded-lg"
                      />
                    </div>
                  ) : valueItems.length > 0 || valuesQuery.isFetching ? (
                    <SearchSelect
                      items={valueItems}
                      value={draft.text || null}
                      onChange={(next) =>
                        setDraft((d) => ({ ...d, text: next ?? "" }))
                      }
                      placeholder={
                        valuesQuery.isFetching
                          ? t("filtered.loadingValues")
                          : t("filtered.valuePlaceholder")
                      }
                      searchPlaceholder={t("filtered.valueSearch")}
                      emptyText={t("filtered.noValues")}
                      recentsKey={`purge-filter-text:${entity}:${draftColumn?.key ?? "name"}`}
                      disabled={!draftColumn || (valuesQuery.isFetching && valueItems.length === 0)}
                    />
                  ) : (
                    <Input
                      value={draft.text}
                      onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
                      placeholder={t("filtered.textPlaceholder")}
                      disabled={!draftColumn}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") applyDraft();
                      }}
                      className="h-9 rounded-lg"
                    />
                  )}
                </div>

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9 shrink-0 cursor-pointer rounded-lg"
                  disabled={!draftColumn}
                  onClick={applyDraft}
                >
                  <Plus className="h-4 w-4" />
                  <span className="ms-1.5">{t("filtered.addFilter")}</span>
                </Button>
                {draft.column ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-9 shrink-0 cursor-pointer rounded-lg"
                    onClick={resetDraft}
                  >
                    {t("filtered.clearDraft")}
                  </Button>
                ) : null}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">
                {t("filtered.activeFilters", { count: activeCount })}
              </span>
              {activeCount === 0 ? (
                <span className="text-[11px] text-muted-foreground">
                  {t("filtered.noFilters")}
                </span>
              ) : (
                Object.entries(active).map(([key, value]) => {
                  const column = columns.find((entry) => entry.key === key);
                  if (!column) return null;
                  return (
                    <button
                      key={key}
                      type="button"
                      className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
                      onClick={() => {
                        setDraft(valueToDraft(column, value));
                        setPage(1);
                      }}
                      title={t("filtered.editFilter")}
                    >
                      <span className="truncate">
                        {purgeFilterColumnLabel(tl, entity, key)}:{" "}
                        {describePurgeFilter(
                          tl,
                          column,
                          value,
                        )}
                      </span>
                      <X
                        className="h-3 w-3 shrink-0"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeFilter(key);
                        }}
                      />
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {blocked ? (
            <ul className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {blockers.map((blocker) => (
                <li key={blocker}>{purgeBlockerLabel(t, blocker)}</li>
              ))}
            </ul>
          ) : null}

          {/* The review list is the gate: nothing is deleted that was not shown
              here first, and the count above it is the same `matched_rows` count
              the delete will resolve. */}
          {activeCount > 0 ? (
            <div className="rounded-xl border border-border">
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <span className="text-sm font-medium">
                  {preview.isError
                    ? t("errors.previewFailed")
                    : preview.isLoading
                      ? t("clearAll.counting")
                      : t("filtered.matchCount", { count })}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 cursor-pointer px-1.5"
                    disabled={page <= 1 || reviewQuery.isFetching}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-[11px] text-muted-foreground">
                    {t("pageOf", { page, total: totalPages })}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 cursor-pointer px-1.5"
                    disabled={page >= totalPages || reviewQuery.isFetching}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="max-h-56 overflow-y-auto">
                {reviewQuery.isLoading ? (
                  <div className="flex h-24 items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : rows.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {t("filtered.reviewEmpty")}
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {rows.map((row) => (
                      <li
                        key={`${row.kind}:${row.id}`}
                        className="flex items-center gap-2 px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{row.label}</span>
                          {row.sublabel ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {row.sublabel}
                            </span>
                          ) : null}
                        </span>
                        {row.status ? (
                          <Badge variant="outline" className="shrink-0 capitalize">
                            {row.status}
                          </Badge>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="px-5 pb-4 pt-3">
          <AppModalFooter
            title={t("filtered.title", { module: moduleLabel })}
            subtitle={
              blocked
                ? t("filtered.blockedBody", { module: moduleLabel })
                : activeCount === 0
                  ? t("filtered.subtitle")
                  : busy
                    ? t("clearAll.counting")
                    : t("filtered.subtitle")
            }
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 cursor-pointer rounded-md"
              onClick={() => onOpenChange(false)}
            >
              {t("filtered.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-9 cursor-pointer rounded-md"
              disabled={activeCount === 0 || count === 0 || blocked || busy || noColumns}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
              <span className="ms-1.5">
                {t("filtered.deleteMatching", { count })}
              </span>
            </Button>
          </AppModalFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The per-module entry point. Renders nothing unless the operator is a super
 * admin *and* the module has a filter spec, so it can never appear where the
 * server would answer `unknown_entity`.
 */
export function ClearFilteredModuleButton({
  entity,
  className,
  compact = false,
}: {
  entity: string;
  className?: string;
  compact?: boolean;
}) {
  const t = useTranslations("pages.settings.dataCleanup.filtered");
  const { isSuperAdmin } = useAuth();
  const [open, setOpen] = useState(false);

  if (!isSuperAdmin || !isPurgeFilterEntity(entity)) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={`h-9 shrink-0 cursor-pointer rounded-lg px-2.5 ${className ?? ""}`}
        onClick={() => setOpen(true)}
      >
        <Filter className="h-4 w-4" />
        {compact ? null : (
          <span className="ms-1.5 hidden md:inline">{t("button")}</span>
        )}
      </Button>
      <PurgeFilteredDialog open={open} onOpenChange={setOpen} entity={entity} />
    </>
  );
}
