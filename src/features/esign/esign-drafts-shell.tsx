"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { AppDataTable, AppDataTableRow, TableCell } from "@/components/app/app-data-table";
import { SimpleConfirmDialog } from "@/components/simple-confirm-dialog";
import { StatusPill } from "@/components/dashboard/status-pill";
import { TabBar } from "@/components/dashboard/tab-bar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, useRouter } from "@/i18n/navigation";
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
 */
export function EsignDraftsShell() {
  const t = useTranslations("pages.requests.esign.drafts");
  const tHub = useTranslations("pages.requests.esign.hub");
  const router = useRouter();
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

  const visible = useMemo(
    () => (kind === "all" ? drafts : drafts.filter((row) => row.kind === kind)),
    [drafts, kind],
  );

  const tabs = [
    { id: "all", label: `${t("tabAll")} (${counts.all})` },
    { id: "single", label: `${t("tabSingle")} (${counts.single})` },
    { id: "bulk", label: `${t("tabBulk")} (${counts.bulk})` },
  ];

  function resume(row: EsignDraftRow) {
    const path = row.kind === "bulk" ? "/requests/esign/bulk" : "/requests/esign/send";
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
          { label: tHub("requests"), href: "/requests" },
          { label: tHub("title"), href: "/requests/esign" },
          { label: t("title") },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 cursor-pointer"
              render={<Link href="/requests/esign" />}
            >
              {t("back")}
            </Button>
            <Button
              size="sm"
              className="h-9 cursor-pointer"
              render={<Link href="/requests/esign/send" />}
            >
              {t("newDraft")}
            </Button>
          </div>
        }
      />

      <AppListCard className="p-0">
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
          <AppDataTable
            columns={[
              { id: "draft", label: t("colDraft") },
              { id: "template", label: t("colTemplate") },
              { id: "rows", label: t("colRecipients") },
              { id: "lang", label: t("colLanguage") },
              { id: "author", label: t("colAuthor") },
              { id: "updated", label: t("colUpdated") },
              { id: "actions", label: t("colActions"), className: "text-end" },
            ]}
          >
            {visible.map((row) => (
              <AppDataTableRow key={row.id} onClick={() => resume(row)}>
                <TableCell>
                  <span className="text-sm font-medium">
                    {row.title?.trim() || t("untitled")}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <StatusPill variant={row.kind === "bulk" ? "warning" : "neutral"}>
                      {row.kind === "bulk" ? t("kindBulk") : t("kindSingle")}
                    </StatusPill>
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </span>
                </TableCell>
                <TableCell className="text-xs">{row.template_name ?? "—"}</TableCell>
                <TableCell className="text-xs tabular-nums">
                  {row.kind === "bulk" ? row.row_count : 1}
                </TableCell>
                <TableCell className="text-xs uppercase">{row.language}</TableCell>
                <TableCell className="max-w-[160px] truncate text-xs">
                  {row.created_by_name ?? "—"}
                </TableCell>
                <TableCell className="text-[11px] tabular-nums text-muted-foreground">
                  {formatEsignTrackerDate(row.updated_at)}
                </TableCell>
                <TableCell className="text-end">
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
                </TableCell>
              </AppDataTableRow>
            ))}
          </AppDataTable>
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
