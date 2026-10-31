"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Layers, LayoutList, Loader2, Plus, RefreshCw, UserRound } from "lucide-react";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { groupRows } from "@/components/app/app-list-controls";
import { ToggleChip } from "@/components/app/toggle-chip";
import {
  TableGridCards,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import type { FrameStatus } from "@/components/app/status-badge";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import { EsignDotKpis } from "./esign-kpi-strip";
import { EsignIndividualSentPanel } from "./esign-individual-sent-panel";
import { parseSentScope, SENT_SCOPES, type SentScope } from "./esign-sent-scope";
import {
  ESIGN_TRACKER_TABS,
  batchStageKey,
  buildEsignTracker,
  filterTrackerBatches,
  formatEsignTrackerDate,
  trackerFilterOptions,
  trackerTabCounts,
  type EsignTrackerBatch,
  type EsignTrackerTab,
} from "./esign-tracker";
import { retryFailedEsignBatchRows } from "./esign-sender-actions";
import { useEsignBatchKpis, useEsignBatches, useEsignTrackerRecipients } from "./use-esign";
import type { EsignBatchStage } from "./esign-recipient-stage";
import type { EsignBatchRow, EsignTrackerRecipient } from "./types";

/**
 * Module-level empty fallbacks.
 *
 * `?? []` in the render body allocates a new array on every render, so every
 * memo that reads it re-fires — the shape that once looped this panel's Add
 * form into a React #185. A shared frozen constant keeps the identity stable
 * while the query is pending.
 */
const NO_BATCHES: EsignBatchRow[] = [];
const NO_RECIPIENTS: EsignTrackerRecipient[] = [];

/**
 * `Sent for signature` — reference panel D2.
 *
 * The screen answers one question, "who is still holding a document", and every
 * number on it is derived from the *recipients* rather than from the batch's own
 * dispatch status. That distinction is the reason this page exists separately
 * from `/requests/esign/batches`: a batch whose every row was emailed
 * successfully reads `completed` in `esign_batches.status` while nobody has
 * signed anything, and an operator who reads that as "done" stops chasing it.
 * `esignBatchStage` derives the real stage, and it is computed once per batch
 * here and read by the KPI tile, the tab, the progress cell and the filter —
 * four places that must never disagree.
 *
 * The four tiles come from `admin_esign_batch_kpis`, not a capped page
 * roll-up, so a 200-row list cannot under-count the fleet.
 */
function esignDeskPaths(pathname: string) {
  const desk = pathname.includes("/employeedesk");
  return {
    desk,
    outgoingHref: desk ? "/employeedesk" : "/requests/esign",
    batchesHref: "/employeedesk/esign/batches",
    sendHref: desk ? "/employeedesk/esign/send" : "/requests/esign/send",
    detailHref: (id: string) =>
      desk ? `/employeedesk/esign/batches/${id}` : `/requests/esign/batches/${id}`,
  };
}

export function EsignBatchesShell() {
  const t = useTranslations("pages.requests.esign.tracker");
  const tHub = useTranslations("pages.requests.esign.hub");
  const tRcm = useTranslations("pages.rcmV2");
  const router = useRouter();
  const pathname = usePathname();
  const paths = esignDeskPaths(pathname);
  const breadcrumbs = paths.desk
    ? [
        { label: tRcm("hubTitle"), href: paths.outgoingHref },
        { label: tRcm("outgoingShort"), href: paths.outgoingHref },
        { label: t("title") },
      ]
    : [
        { label: tHub("title"), href: paths.outgoingHref },
        { label: t("title") },
      ];
  const newTemplateHref = paths.desk
    ? "/employeedesk/esign/templates/new"
    : "/requests/esign/templates/new";
  const queryClient = useQueryClient();

  const batchesQuery = useEsignBatches();
  const recipientsQuery = useEsignTrackerRecipients();
  const kpisQuery = useEsignBatchKpis();

  const searchParams = useSearchParams();
  const scope = parseSentScope(searchParams.get("scope"));
  const [tab, setTab] = useState<EsignTrackerTab>("all");
  const [search, setSearch] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [senderId, setSenderId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [retryingAll, setRetryingAll] = useState(false);

  function setScope(next: SentScope) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete("scope");
    else params.set("scope", next);
    const query = params.toString();
    router.replace(query ? `${paths.batchesHref}?${query}` : paths.batchesHref);
  }

  // Module-level fallbacks, not `?? []`: a fresh array on every render is a new
  // identity for every memo that reads it, which is the `= []` shape that once
  // looped this panel's Add form to a React #185.
  const batches = batchesQuery.data?.rows ?? NO_BATCHES;
  const recipients = recipientsQuery.data?.recipients ?? NO_RECIPIENTS;

  const tracker = useMemo(
    () => buildEsignTracker(batches, recipients),
    [batches, recipients],
  );
  const kpis = kpisQuery.data?.kpis ?? {
    batchesSent: 0,
    waitingSignatures: 0,
    fullySigned: 0,
    declined: 0,
  };
  const tabCounts = useMemo(() => trackerTabCounts(tracker), [tracker]);
  const options = useMemo(() => trackerFilterOptions(tracker), [tracker]);
  const columns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "batch", label: t("colBatch"), locked: true },
      { id: "template", label: t("colTemplate"), locked: true },
      { id: "recipients", label: t("colRecipients") },
      { id: "progress", label: t("colProgress") },
      { id: "status", label: t("colStatus"), categorical: true },
      { id: "sent", label: t("colSent") },
      { id: "actions", label: t("colActions"), locked: true },
    ],
    [t],
  );
  const prefs = useTablePrefs("esign-batches", columns);
  const shownColumns = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return filterTrackerBatches(tracker, tab).filter((row) => {
      if (templateId && row.batch.template_id !== templateId) return false;
      if (senderId && row.batch.created_by_id !== senderId) return false;
      const day = kuwaitBatchDay(row.batch.created_at);
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      if (!needle) return true;
      const codeHit = recipients.some(
        (recipient) =>
          recipient.batch_id === row.batch.id &&
          recipient.request_code.toLowerCase().includes(needle),
      );
      return (
        codeHit ||
        row.batch.batch_code.toLowerCase().includes(needle) ||
        row.batch.title.toLowerCase().includes(needle) ||
        (row.batch.template_name ?? "").toLowerCase().includes(needle) ||
        (row.batch.category_label ?? "").toLowerCase().includes(needle) ||
        (row.batch.created_by_name ?? "").toLowerCase().includes(needle)
      );
    });
  }, [tracker, tab, templateId, senderId, dateFrom, dateTo, search, recipients]);

  const filtered = useMemo(() => {
    const query = prefs.appliedQuery.trim().toLowerCase();
    if (!query) return visible;
    return visible.filter((row) => {
      const status = t(`batchStatus.${batchStageKey(row.stage)}`);
      return [
        row.batch.batch_code,
        row.batch.title,
        row.batch.template_name,
        row.batch.category_label,
        row.batch.created_by_name,
        status,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [visible, prefs.appliedQuery, t]);

  const grouped = useMemo(
    () =>
      groupRows(
        filtered,
        prefs.groupBy,
        {
          status: (row) => t(`batchStatus.${batchStageKey(row.stage)}`),
        },
        {},
        "—",
      ),
    [filtered, prefs.groupBy, t],
  );

  const failedBatches = useMemo(
    () => filtered.filter((row) => row.batch.failed_count > 0),
    [filtered],
  );

  async function retryAll() {
    setRetryingAll(true);
    let sent = 0;
    let failed = 0;
    let refused = 0;
    // Sequential, not `Promise.all`: each call claims rows under a lock and
    // renders PDFs in a headless browser, so fifteen concurrent retries would
    // fight over the same machine for no wall-clock win.
    for (const row of failedBatches) {
      const result = await retryFailedEsignBatchRows(row.batch.id);
      if (!result.ok) {
        refused += 1;
        continue;
      }
      // `created` and `failed` come back as the batch's *recounted* totals,
      // not as this pass's deltas, so the tile has to subtract what the batch
      // already had or a retry that saved one row would report all thirty.
      sent += Math.max(result.created - row.batch.created_count, 0);
      failed += result.failed;
    }
    setRetryingAll(false);
    await queryClient.invalidateQueries({ queryKey: queryKeys.esign.all() });
    if (refused > 0) {
      toast.error(t("errors.retryFailed"));
      return;
    }
    if (sent === 0 && failed === 0) {
      toast.info(t("retryNone"));
      return;
    }
    toast.success(t("retryDone", { created: sent, failed }));
  }

  const loading = batchesQuery.isLoading || recipientsQuery.isLoading;
  const error = batchesQuery.data?.error ?? recipientsQuery.data?.error;

  // `TabBar` renders a plain label, so the count rides inside the string. It is
  // read from `trackerTabCounts`, the same roll-up the tiles and the filter use.
  const tabItems = ESIGN_TRACKER_TABS.map((id) => ({
    id,
    label: t(`tabs.${tabKey(id)}`),
    count: tabCounts[id],
  }));
  const showBatch = scope === "all" || scope === "batch";
  const showIndividual = scope === "all" || scope === "individual";

  const batchToolbar = (
    <TableToolbar
      prefs={prefs}
      entity={t("title")}
      columns={columns}
      rowKind="dynamic"
      entityList
      filteredCount={filtered.length}
      totalCount={tracker.length}
      onAdd={() => router.push(newTemplateHref)}
      addLabel={t("newFromTemplate")}
    />
  );
  const tableHasRows = !loading && !error && filtered.length > 0 && prefs.view === "list";
  const batchTable = (
    <>
      {tableHasRows ? null : batchToolbar}
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <AppEmptyState title={t("emptyTitle")} description={error} />
      ) : filtered.length === 0 ? (
        <AppEmptyState
          title={tracker.length === 0 ? t("emptyTitle") : t("emptyFiltered")}
          description={tracker.length === 0 ? t("emptyDescription") : t("clearFilters")}
        />
      ) : prefs.view === "grid" ? (
        <TableGridCards
          rows={filtered.map((row) => ({
            id: row.batch.batch_code,
            name: row.batch.title,
            status: {
              status: stageFrameStatus(row.stage),
              label: t(`batchStatus.${batchStageKey(row.stage)}`),
            },
            fields: [
              {
                label: t("colTemplate"),
                value: row.batch.template_name ?? row.batch.category_label ?? "—",
              },
              { label: t("colRecipients"), value: t("employeesCount", { count: row.progress.total }) },
              {
                label: t("colProgress"),
                value: t("progressSlash", { signed: row.progress.signed, total: row.progress.total }),
              },
              { label: t("colSent"), value: formatEsignTrackerDate(row.batch.created_at) },
            ],
            onOpen: () => router.push(paths.detailHref(row.batch.id)),
          }))}
        />
      ) : (
        <AppDataTable
          toolbar={batchToolbar}
          columns={shownColumns.map((column) => ({
            id: column.id,
            label: column.id === "actions" ? t("colActions") : column.label,
            className: column.id === "actions" ? "text-end" : undefined,
          }))}
        >
          {grouped.flatMap((group) => [
            ...(prefs.groupBy !== "none"
              ? [
                  <AppDataTableRow key={`g-${group.key}`} className="hover:bg-transparent">
                    <TableCell colSpan={shownColumns.length} className="text-xs font-semibold">
                      {group.label} · {group.rows.length}
                    </TableCell>
                  </AppDataTableRow>,
                ]
              : []),
            ...group.rows.map((row) => (
              <BatchRow
                key={row.batch.id}
                row={row}
                t={t}
                trackLabel={tRcm("track")}
                columns={shownColumns}
                onOpen={() => router.push(paths.detailHref(row.batch.id))}
              />
            )),
          ])}
        </AppDataTable>
      )}
    </>
  );

  const batchFilters = (
    <aside className="flex flex-col gap-2 border-b border-border p-3 lg:border-b-0 lg:border-e">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("scopeBatch")}
      </p>
      <CountPills items={tabItems} activeId={tab} onSelect={(id) => setTab(id)} vertical />
      <SearchSelect
        items={options.templates}
        value={templateId}
        onChange={setTemplateId}
        placeholder={t("templateAll")}
        searchPlaceholder={t("searchPlaceholder")}
        recentsKey="esign-batch-template"
        className="w-full"
      />
      <SearchSelect
        items={options.senders}
        value={senderId}
        onChange={setSenderId}
        placeholder={t("senderAll")}
        searchPlaceholder={t("senderSearch")}
        recentsKey="esign-batch-sender"
        className="w-full"
      />
      <label className="block space-y-1 text-xs font-medium text-muted-foreground">
        {t("dateFrom")}
        <Input
          type="date"
          className="h-9"
          value={dateFrom}
          onChange={(event) => setDateFrom(event.target.value)}
        />
      </label>
      <label className="block space-y-1 text-xs font-medium text-muted-foreground">
        {t("dateTo")}
        <Input
          type="date"
          className="h-9"
          value={dateTo}
          onChange={(event) => setDateTo(event.target.value)}
        />
      </label>
      <Button
        type="button"
        variant="outline"
        className="h-9 w-full"
        onClick={() => {
          prefs.setQuery("");
          setSearch("");
          setTemplateId(null);
          setSenderId(null);
          setDateFrom("");
          setDateTo("");
          setTab("all");
        }}
      >
        {t("clearFilters")}
      </Button>
      {failedBatches.length > 0 ? (
        <Button
          variant="outline"
          size="sm"
          className="h-9 cursor-pointer"
          disabled={retryingAll}
          onClick={() => void retryAll()}
        >
          {retryingAll ? (
            <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="me-1.5 h-3.5 w-3.5" />
          )}
          {retryingAll ? t("retrying") : t("retry")}
        </Button>
      ) : null}
    </aside>
  );

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={breadcrumbs}
      />

      {scope === "individual" ? null : (
        <EsignDotKpis
          items={[
            {
              label: t("kpiBatches30d"),
              value: kpis.batchesSent,
              dotClass: "bg-rose-500",
            },
            {
              label: t("kpiWaiting"),
              value: kpis.waitingSignatures,
              unit: t("unitEmployees"),
              dotClass: "bg-sky-500",
            },
            {
              label: t("kpiSigned"),
              value: kpis.fullySigned,
              unit: t("unitBatches"),
              dotClass: "bg-emerald-500",
            },
            {
              label: t("kpiDeclined"),
              value: kpis.declined,
              unit: t("unitEmployees"),
              dotClass: "bg-rose-500",
            },
          ]}
        />
      )}

      <div className="flex flex-wrap gap-1.5">
        {SENT_SCOPES.map((id) => (
          <ToggleChip
            key={id}
            selected={scope === id}
            icon={scopeIcon(id)}
            onClick={() => setScope(id)}
          >
            {t(scopeLabelKey(id))}
          </ToggleChip>
        ))}
      </div>

      {showBatch ? (
        <AppListCard className="p-0">
          <div className="grid min-w-0 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
            {batchFilters}
            <div className="min-w-0">{batchTable}</div>
          </div>
        </AppListCard>
      ) : null}

      {showIndividual ? (
        <AppListCard className="p-0">
          <EsignIndividualSentPanel />
        </AppListCard>
      ) : null}
    </AppPage>
  );
}

function scopeLabelKey(id: SentScope): "scopeAll" | "scopeBatch" | "scopeIndividual" {
  switch (id) {
    case "all":
      return "scopeAll";
    case "batch":
      return "scopeBatch";
    case "individual":
      return "scopeIndividual";
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

function scopeIcon(id: SentScope) {
  switch (id) {
    case "all":
      return LayoutList;
    case "batch":
      return Layers;
    case "individual":
      return UserRound;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

/** `TabBar` ids are the stage keys; only the two multi-word labels differ. */
function tabKey(id: EsignTrackerTab): string {
  switch (id) {
    case "all":
      return "all";
    case "in_progress":
      return "inProgress";
    case "completed":
      return "completed";
    case "has_declines":
      return "hasDeclines";
    case "waiting":
      return "waiting";
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

function kuwaitBatchDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuwait",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function stageFrameStatus(stage: EsignBatchStage): FrameStatus {
  switch (stage) {
    case "completed":
      return "working";
    case "has_declines":
      return "absent";
    case "in_progress":
      return "pending";
    case "waiting":
      return "other";
    default: {
      const unexpected: never = stage;
      return unexpected;
    }
  }
}

function stageDotClass(stage: EsignBatchStage): string {
  switch (stage) {
    case "completed":
      return "text-emerald-700";
    case "has_declines":
      return "text-rose-700";
    case "in_progress":
      return "text-amber-700";
    case "waiting":
      return "text-sky-700";
    default: {
      const unexpected: never = stage;
      return unexpected;
    }
  }
}

function CountPills({
  items,
  activeId,
  onSelect,
  vertical = false,
}: {
  items: { id: EsignTrackerTab; label: string; count: number }[];
  activeId: EsignTrackerTab;
  onSelect: (id: EsignTrackerTab) => void;
  vertical?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex gap-1 rounded-lg bg-muted/70 p-1",
        vertical ? "w-full flex-col" : "inline-flex w-fit flex-wrap",
      )}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 text-xs font-medium",
              vertical ? "h-9 w-full justify-between" : "h-8",
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            {item.label}
            <span className="tabular-nums">{item.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function BatchRow({
  row,
  t,
  trackLabel,
  columns,
  onOpen,
}: {
  row: EsignTrackerBatch;
  t: ReturnType<typeof useTranslations>;
  trackLabel: string;
  columns: TableToolbarColumn[];
  onOpen: () => void;
}) {
  const { batch, progress, stage } = row;
  const tone = stageDotClass(stage);
  const cells: Record<string, ReactNode> = {
    batch: <span className="text-xs font-semibold">{batch.batch_code}</span>,
    template: (
      <>
        <TableNameCell name={batch.title} />
        <span className="block text-xs text-muted-foreground">
          {batch.template_name ?? batch.category_label ?? "—"}
        </span>
      </>
    ),
    recipients: (
      <span className="text-xs text-muted-foreground">
        {t("employeesCount", { count: progress.total })}
      </span>
    ),
    progress: (
      <div className="flex min-w-[140px] flex-col gap-1">
        <span className="text-xs tabular-nums text-muted-foreground">
          {t("progressSlash", { signed: progress.signed, total: progress.total })}
        </span>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-500 transition-[width] duration-200"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      </div>
    ),
    status: (
      <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", tone)}>
        <span className="size-1.5 rounded-full bg-current" aria-hidden />
        {t(`batchStatus.${batchStageKey(stage)}`)}
      </span>
    ),
    sent: (
      <span className="text-xs tabular-nums text-muted-foreground">
        {formatEsignTrackerDate(batch.created_at)}
      </span>
    ),
    actions: (
      <Button
        variant="outline"
        size="sm"
        className="h-8 cursor-pointer px-3 text-xs font-medium"
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
      >
        {trackLabel}
      </Button>
    ),
  };

  return (
    <AppDataTableRow onClick={onOpen}>
      {columns.map((column) => (
        <TableCell key={column.id} className={column.id === "actions" ? "text-end" : undefined}>
          {cells[column.id]}
        </TableCell>
      ))}
    </AppDataTableRow>
  );
}
