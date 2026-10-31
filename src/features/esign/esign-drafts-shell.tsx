"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { groupRows } from "@/components/app/app-list-controls";
import {
  EmptyCell,
  TableGridCards,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { AppDataTable, AppDataTableRow, TableCell } from "@/components/app/app-data-table";
import { SimpleConfirmDialog } from "@/components/simple-confirm-dialog";
import { StatusPill } from "@/components/dashboard/status-pill";
import { TabBar } from "@/components/dashboard/tab-bar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { deleteEsignDraft } from "./esign-sender-actions";
import { formatEsignTrackerDate } from "./esign-tracker";
import { useEsignDrafts } from "./use-esign";
import type { EsignDraftKind, EsignDraftRow } from "./types";

/**
 * Drafts — reference panel F11.
 *
 * A draft is *unfinished work*, not a document, which is why this screen carries
 * no KPI strip and no status pills beyond the two kinds: there is nothing to
 * measure and nothing to chase. What it has to do is get an operator back into
 * the exact composer they left, so every row's primary action resumes that
 * specific screen (`single` → the send composer, `bulk` → the sheet wizard)
 * rather than a generic editor that would have to re-guess the mode.
 *
 * The list is one read (`admin_list_esign_drafts`) and deliberately does not
 * fetch payloads: a bulk draft can carry 400 rows, and pulling all of them to
 * draw a count would put the wizard's payload on a page that only prints
 * numbers. The rows arrive when a draft is resumed, from `admin_get_esign_draft`.
 *
 * Canonical list is `/requests/esign/drafts`. `/employeedesk/esign/drafts`
 * stays 404 so a second URL cannot fork the screen.
 */
export function EsignDraftsShell() {
  const t = useTranslations("pages.requests.esign.drafts");
  const tHub = useTranslations("pages.requests.esign.hub");
  const router = useRouter();
  const pathname = usePathname();
  const isV2 = pathname.includes("/employeedesk");
  const hubHref = isV2 ? "/employeedesk" : "/requests/esign";
  const sendHref = isV2 ? "/employeedesk/esign/send" : "/requests/esign/send";
  const bulkHref = isV2 ? "/employeedesk/esign/bulk" : "/requests/esign/bulk";
  const queryClient = useQueryClient();

  const draftsQuery = useEsignDrafts();
  const drafts = useMemo(() => draftsQuery.data?.rows ?? [], [draftsQuery.data?.rows]);

  const [kind, setKind] = useState<EsignDraftKind | "all">("all");
  const [removeDraft, setRemoveDraft] = useState<EsignDraftRow | null>(null);
  const [removing, setRemoving] = useState(false);

  const counts = useMemo(() => {
    let single = 0;
    let bulk = 0;
    for (const row of drafts) {
      if (row.kind === "bulk") bulk += 1;
      else single += 1;
    }
    return { all: drafts.length, single, bulk };
  }, [drafts]);

  const draftColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "draft", label: t("colDraft"), locked: true },
      { id: "template", label: t("colTemplate") },
      { id: "rows", label: t("colRecipients") },
      { id: "author", label: t("colAuthor"), categorical: true },
      { id: "updated", label: t("colUpdated") },
      { id: "actions", label: t("colActions"), locked: true },
    ],
    [t],
  );
  const tablePrefs = useTablePrefs("esign.drafts", draftColumns);
  const shownColumns = tablePrefs.orderedColumns.filter((column) => tablePrefs.isVisible(column.id));
  const visible = useMemo(() => {
    const scoped = kind === "all" ? drafts : drafts.filter((row) => row.kind === kind);
    const query = tablePrefs.appliedQuery.trim().toLowerCase();
    if (!query) return scoped;
    return scoped.filter((row) =>
      [row.title, row.template_name, row.created_by_name].join(" ").toLowerCase().includes(query),
    );
  }, [drafts, kind, tablePrefs.appliedQuery]);
  const grouped = useMemo(
    () =>
      groupRows(visible, tablePrefs.groupBy, { author: (row) => row.created_by_name }, {}, "—"),
    [tablePrefs.groupBy, visible],
  );

  const tabs = [
    { id: "all", label: `${t("tabAll")} (${counts.all})` },
    { id: "single", label: `${t("tabSingle")} (${counts.single})` },
    { id: "bulk", label: `${t("tabBulk")} (${counts.bulk})` },
  ];

  function resume(row: EsignDraftRow) {
    const path = row.kind === "bulk" ? bulkHref : sendHref;
    router.push(`${path}?draft=${row.id}`);
  }

  async function confirmRemove() {
    if (!removeDraft) return;
    setRemoving(true);
    const result = await deleteEsignDraft(removeDraft.id);
    setRemoving(false);
    if (!result.ok) {
      toast.error(result.error ?? t("removeFailed"));
      return;
    }
    toast.success(t("removeDone"));
    setRemoveDraft(null);
    await queryClient.invalidateQueries({ queryKey: queryKeys.esign.all() });
  }

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: tHub("requests"), href: "/employeedesk" },
          { label: tHub("title"), href: hubHref },
          { label: t("title") },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 cursor-pointer"
              render={<Link href={hubHref} />}
            >
              {t("back")}
            </Button>
          </div>
        }
      />

      <AppListCard className="p-0">
        <TableToolbar
          prefs={tablePrefs}
          entity={t("title")}
          columns={draftColumns}
          rowKind="dynamic"
          entityList
          filteredCount={visible.length}
          totalCount={drafts.length}
          onAdd={() => router.push(sendHref)}
          addLabel={t("newDraft")}
        />
        <div className="border-b border-border p-3">
          <TabBar items={tabs} activeId={kind} onSelect={(id) => setKind(id as EsignDraftKind | "all")} />
        </div>

        {draftsQuery.isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : draftsQuery.data?.error ? (
          <AppEmptyState title={t("emptyTitle")} description={draftsQuery.data.error} />
        ) : visible.length === 0 ? (
          <AppEmptyState
            title={drafts.length === 0 ? t("emptyTitle") : t("emptyFiltered")}
            description={drafts.length === 0 ? t("emptyDescription") : undefined}
          />
        ) : (
          tablePrefs.view === "grid" ? (
            <TableGridCards
              rows={visible.map((row) => ({
                id: row.id,
                name: row.title?.trim() || t("untitled"),
                fields: [
                  { label: t("colTemplate"), value: row.template_name ?? "—" },
                  { label: t("colAuthor"), value: row.created_by_name ?? "—" },
                ],
                onOpen: () => resume(row),
              }))}
            />
          ) : (
          <AppDataTable
            columns={shownColumns.map((column) => ({
              id: column.id,
              label: column.label,
              className: column.id === "actions" ? "text-end" : undefined,
            }))}
          >
            {grouped.flatMap((group) => [
              ...(tablePrefs.groupBy !== "none"
                ? [
                    <AppDataTableRow key={`g-${group.key}`} className="hover:bg-transparent">
                      <TableCell colSpan={shownColumns.length} className="text-xs font-semibold">
                        {group.label} · {group.rows.length}
                      </TableCell>
                    </AppDataTableRow>,
                  ]
                : []),
              ...group.rows.map((row) => {
                const cells: Record<string, ReactNode> = {
                  draft: (
                    <>
                      <TableNameCell name={row.title?.trim() || t("untitled")} />
                      <span className="mt-0.5 flex items-center gap-1.5">
                        <StatusPill variant={row.kind === "bulk" ? "warning" : "neutral"}>
                          {row.kind === "bulk" ? t("kindBulk") : t("kindSingle")}
                        </StatusPill>
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </span>
                    </>
                  ),
                  template: row.template_name ? row.template_name : <EmptyCell />,
                  rows: row.kind === "bulk" ? row.row_count : 1,
                  author: row.created_by_name ? row.created_by_name : <EmptyCell />,
                  updated: formatEsignTrackerDate(row.updated_at),
                  actions: (
                <div className="text-end">
                  <div
                    className="flex items-center justify-end gap-1"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 cursor-pointer text-xs font-medium text-primary hover:bg-primary/10"
                      onClick={() => resume(row)}
                    >
                      {t("resume")}
                    </Button>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 cursor-pointer p-0 text-destructive hover:bg-destructive/10"
                            onClick={() => setRemoveDraft(row)}
                            aria-label={t("remove")}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        }
                      />
                      <TooltipContent>{t("remove")}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
                  ),
                };
                return (
              <AppDataTableRow key={row.id} onClick={() => resume(row)}>
                {shownColumns.map((column) => (
                  <TableCell key={column.id} className={column.id === "actions" ? "text-end" : undefined}>
                    {cells[column.id] ?? <EmptyCell />}
                  </TableCell>
                ))}
              </AppDataTableRow>
                );
              }),
            ])}
          </AppDataTable>
          )
        )}
      </AppListCard>

      <SimpleConfirmDialog
        open={removeDraft != null}
        onOpenChange={(open) => !open && setRemoveDraft(null)}
        title={t("removeTitle")}
        description={t("removeConfirm", { name: removeDraft?.title?.trim() || t("untitled") })}
        confirmLabel={t("removeSubmit")}
        confirmVariant="destructive"
        onConfirm={confirmRemove}
        isPending={removing}
      />
    </AppPage>
  );
}
