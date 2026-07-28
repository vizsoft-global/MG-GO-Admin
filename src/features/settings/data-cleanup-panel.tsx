"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ChevronLeft, ChevronRight, Eye, Loader2, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppPage } from "@/components/app/app-page";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  CleanupCandidate,
  CleanupPreviewItem,
  CleanupPurgeSelection,
  CleanupTab,
} from "./data-cleanup-actions";
import { useCleanupCandidates, useCleanupPreview, useCleanupPurge } from "./use-data-cleanup";

const TABS: CleanupTab[] = [
  "deliveries",
  "drivers",
  "restaurants",
  "zones",
  "delivery_rules",
  "incentive_rules",
  "assets",
];

function selectionKey(item: CleanupPurgeSelection): string {
  return `${item.purgeType}:${item.purgeId}`;
}

function toSelection(item: CleanupCandidate): CleanupPurgeSelection {
  return { purgeId: item.purgeId, purgeType: item.purgeType };
}

function confirmPhrase(tab: CleanupTab, count: number, t: ReturnType<typeof useTranslations<"pages.settings.dataCleanup">>): string {
  const n = String(count);
  switch (tab) {
    case "drivers":
      return t("confirmPhrases.drivers", { count: n });
    case "zones":
      return t("confirmPhrases.zones", { count: n });
    case "restaurants":
      return t("confirmPhrases.restaurants", { count: n });
    case "delivery_rules":
      return t("confirmPhrases.deliveryRules", { count: n });
    case "incentive_rules":
      return t("confirmPhrases.incentiveRules", { count: n });
    case "assets":
      return t("confirmPhrases.assets", { count: n });
    case "deliveries":
      return t("confirmPhrases.deliveries", { count: n });
  }
}

function PreviewCounts({ item, t }: { item: CleanupPreviewItem; t: ReturnType<typeof useTranslations<"pages.settings.dataCleanup">> }) {
  const entries = Object.entries(item.counts).filter(([, v]) => v > 0);
  return (
    <li className="rounded-lg border border-border px-3 py-2 text-sm">
      <p className="font-mono text-xs text-muted-foreground">{item.id}</p>
      {item.blockers.length > 0 ? (
        <p className="mt-1 text-destructive">
          {t("preview.blocked")}: {item.blockers.join(", ")}
        </p>
      ) : null}
      {entries.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {entries.map(([key, value]) => (
            <Badge key={key} variant="secondary">
              {key}: {value}
            </Badge>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-muted-foreground">{t("preview.noRelatedRows")}</p>
      )}
      {item.storage_key_count > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("preview.storageKeys", { count: item.storage_key_count })}
        </p>
      ) : null}
    </li>
  );
}

function CleanupTabPanel({
  tab,
  selectedKeys,
  onToggle,
  onTogglePage,
  onClear,
}: {
  tab: CleanupTab;
  selectedKeys: Set<string>;
  onToggle: (item: CleanupCandidate) => void;
  onTogglePage: (items: CleanupCandidate[], checked: boolean) => void;
  onClear: () => void;
}) {
  const t = useTranslations("pages.settings.dataCleanup");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [archivedOnly, setArchivedOnly] = useState(false);

  const { data, isLoading, isFetching, refetch } = useCleanupCandidates(
    tab,
    search,
    page,
    tab === "drivers" ? archivedOnly : undefined,
  );

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 25;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageSelectedCount = items.filter((item) => selectedKeys.has(selectionKey(toSelection(item)))).length;
  const allPageSelected = items.length > 0 && pageSelectedCount === items.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t("searchPlaceholder")}
            className="rounded-lg ps-9"
          />
        </div>
        {tab === "drivers" ? (
          <div className="flex items-center gap-2">
            <Switch
              id={`archived-${tab}`}
              checked={archivedOnly}
              onCheckedChange={(checked) => {
                setArchivedOnly(checked);
                setPage(1);
              }}
            />
            <Label htmlFor={`archived-${tab}`} className="text-sm">
              {t("archivedOnly")}
            </Label>
          </div>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="cursor-pointer rounded-lg"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : t("refresh")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Checkbox
            id={`select-page-${tab}`}
            checked={allPageSelected}
            onCheckedChange={(checked) => onTogglePage(items, checked === true)}
          />
          <Label htmlFor={`select-page-${tab}`} className="cursor-pointer ps-2">
            {t("selectPage")}
          </Label>
        </div>
        <span>{t("totalCount", { count: total })}</span>
      </div>

      <div className="min-h-[320px] rounded-xl border border-border">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => {
              const key = selectionKey(toSelection(item));
              const checked = selectedKeys.has(key);
              return (
                <li key={item.id}>
                  <label className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-muted/40">
                    <Checkbox checked={checked} onCheckedChange={() => onToggle(item)} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{item.label}</span>
                      {item.sublabel ? (
                        <span className="block text-xs text-muted-foreground">{item.sublabel}</span>
                      ) : null}
                    </span>
                    {item.status ? (
                      <Badge variant="outline" className="shrink-0 capitalize">
                        {item.status}
                      </Badge>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="cursor-pointer rounded-lg"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm text-muted-foreground">
          {t("pageOf", { page, total: totalPages })}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="cursor-pointer rounded-lg"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        {selectedKeys.size > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="cursor-pointer rounded-lg"
            onClick={onClear}
          >
            {t("clearSelection")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function DataCleanupPanel() {
  const t = useTranslations("pages.settings.dataCleanup");
  const [activeTab, setActiveTab] = useState<CleanupTab>("deliveries");
  const [selectedByTab, setSelectedByTab] = useState<Record<CleanupTab, Map<string, CleanupPurgeSelection>>>(
    () =>
      Object.fromEntries(TABS.map((tab) => [tab, new Map()])) as Record<
        CleanupTab,
        Map<string, CleanupPurgeSelection>
      >,
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItems, setPreviewItems] = useState<CleanupPreviewItem[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPreviewPending, startPreviewTransition] = useTransition();

  const previewMutation = useCleanupPreview();
  const purgeMutation = useCleanupPurge();

  const currentSelections = useMemo(
    () => [...(selectedByTab[activeTab]?.values() ?? [])],
    [selectedByTab, activeTab],
  );

  const updateSelection = useCallback((tab: CleanupTab, updater: (map: Map<string, CleanupPurgeSelection>) => void) => {
    setSelectedByTab((prev) => {
      const next = { ...prev };
      const map = new Map(prev[tab]);
      updater(map);
      next[tab] = map;
      return next;
    });
  }, []);

  const handleToggle = useCallback(
    (tab: CleanupTab, item: CleanupCandidate) => {
      updateSelection(tab, (map) => {
        const sel = toSelection(item);
        const key = selectionKey(sel);
        if (map.has(key)) map.delete(key);
        else map.set(key, sel);
      });
    },
    [updateSelection],
  );

  const handleTogglePage = useCallback(
    (tab: CleanupTab, items: CleanupCandidate[], checked: boolean) => {
      updateSelection(tab, (map) => {
        for (const item of items) {
          const sel = toSelection(item);
          const key = selectionKey(sel);
          if (checked) map.set(key, sel);
          else map.delete(key);
        }
      });
    },
    [updateSelection],
  );

  const handlePreview = () => {
    if (currentSelections.length === 0) {
      toast.error(t("errors.nothingSelected"));
      return;
    }
    startPreviewTransition(async () => {
      try {
        const result = await previewMutation.mutateAsync(currentSelections);
        setPreviewItems(result.items);
        setPreviewOpen(true);
      } catch {
        toast.error(t("errors.previewFailed"));
      }
    });
  };

  const handlePurge = async () => {
    try {
      const result = await purgeMutation.mutateAsync(currentSelections);
      if (result.errors.length > 0) {
        toast.warning(t("partialPurge", { deleted: result.deleted, errors: result.errors.join("; ") }));
      } else {
        toast.success(t("purgeSuccess", { count: result.deleted }));
      }
      updateSelection(activeTab, (map) => map.clear());
      setDeleteOpen(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : t("errors.purgeFailed");
      toast.error(message);
    }
  };

  const hasBlockers = previewItems.some((item) => item.blockers.length > 0);
  const confirmText = confirmPhrase(activeTab, currentSelections.length, t);

  return (
    <AppPage>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-100">{t("orderBanner.title")}</p>
            <p className="mt-1 text-amber-800/90 dark:text-amber-200/90">{t("orderBanner.body")}</p>
          </div>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as CleanupTab)}
        className="space-y-4"
      >
        <TabsList className="flex h-auto flex-wrap justify-start gap-1 rounded-xl bg-muted/50 p-1">
          {TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab} className="cursor-pointer rounded-lg">
              {t(`tabs.${tab}`)}
              {(selectedByTab[tab]?.size ?? 0) > 0 ? (
                <Badge variant="secondary" className="ms-2">
                  {selectedByTab[tab]?.size}
                </Badge>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map((tab) => (
          <TabsContent key={tab} value={tab}>
            <CleanupTabPanel
              tab={tab}
              selectedKeys={new Set(selectedByTab[tab]?.keys() ?? [])}
              onToggle={(item) => handleToggle(tab, item)}
              onTogglePage={(items, checked) => handleTogglePage(tab, items, checked)}
              onClear={() => updateSelection(tab, (map) => map.clear())}
            />
          </TabsContent>
        ))}
      </Tabs>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-border bg-background/95 p-4 backdrop-blur">
        <span className="me-auto text-sm text-muted-foreground">
          {t("selectedCount", { count: currentSelections.length })}
        </span>
        <Button
          type="button"
          variant="outline"
          className="cursor-pointer rounded-lg"
          disabled={currentSelections.length === 0 || isPreviewPending}
          onClick={handlePreview}
        >
          {isPreviewPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Eye className="h-4 w-4" />
              {t("preview")}
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="destructive"
          className="cursor-pointer rounded-lg"
          disabled={currentSelections.length === 0 || purgeMutation.isPending}
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
          {t("deleteSelected")}
        </Button>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("preview.title")}</DialogTitle>
            <DialogDescription>{t("preview.description")}</DialogDescription>
          </DialogHeader>
          <ul className="max-h-[50vh] space-y-2 overflow-y-auto py-2">
            {previewItems.map((item) => (
              <PreviewCounts key={item.id} item={item} t={t} />
            ))}
          </ul>
          {hasBlockers ? (
            <p className="text-sm text-destructive">{t("preview.blockersWarning")}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" className="cursor-pointer rounded-lg" onClick={() => setPreviewOpen(false)}>
              {t("preview.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        itemTitle={t("deleteDialog.title")}
        itemName={t("deleteDialog.itemName", { count: currentSelections.length })}
        confirmText={confirmText}
        warning={t("deleteDialog.warning")}
        onConfirm={handlePurge}
        isPending={purgeMutation.isPending}
      />
    </AppPage>
  );
}
