"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ArrowLeft, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { AppPage } from "@/components/app/app-page";
import { StatusPill } from "@/components/dashboard/status-pill";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import {
  EmptyCell,
  TableGridCards,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { useAuth } from "@/contexts/auth-context";
import { useImportBatches, useRevertImportBatch } from "./use-verifications";

function batchVariant(
  status: string,
): "success" | "warning" | "danger" | "neutral" {
  switch (status) {
    case "applied":
      return "success";
    case "reverted":
      return "neutral";
    default:
      return "warning";
  }
}

function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function VerificationImportsPageShell() {
  const t = useTranslations("pages.verifications.imports");
  const { isSuperAdmin } = useAuth();
  const { data: batches = [], isLoading, refetch } = useImportBatches();
  const revert = useRevertImportBatch();
  const [revertId, setRevertId] = useState<string | null>(null);
  const [revertName, setRevertName] = useState("");
  const [isPending, startTransition] = useTransition();
  const columns = useMemo((): TableToolbarColumn[] => [
    { id: "file", label: t("colFile"), locked: true },
    { id: "status", label: t("colStatus") },
    { id: "rows", label: t("colRows") },
    { id: "applied", label: t("colApplied") },
    { id: "uploaded", label: t("colUploaded") },
    { id: "actions", label: t("colActions") },
  ], [t]);
  const prefs = useTablePrefs("verification-imports", columns);
  const shown = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));
  const needle = prefs.appliedQuery.trim().toLowerCase();
  const rows = batches.filter((b) => !needle || `${b.file_name} ${b.status}`.toLowerCase().includes(needle));

  const handleRevert = () => {
    if (!revertId) return;
    startTransition(async () => {
      const result = await revert.mutateAsync(revertId);
      if ("error" in result) {
        toast.error(t("revertFailed"));
        return;
      }
      toast.success(t("revertSuccess"));
      setRevertId(null);
      void refetch();
    });
  };

  return (
    <AppPage>
      <div className="mb-4 flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="cursor-pointer"
          nativeButton={false}
          render={<Link href="/dpd-verification" />}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <TableToolbar
            prefs={prefs}
            entity={t("title")}
            columns={columns}
            rowKind="dynamic"
            entityList
            filteredCount={rows.length}
            totalCount={batches.length}
          />
          {prefs.view === "grid" ? (
            <TableGridCards
              rows={rows.map((b) => ({
                id: b.id,
                name: b.file_name,
                status: { status: "neutral", label: b.status },
                fields: [
                  { label: t("colRows"), value: String(b.row_count) },
                  { label: t("colApplied"), value: String(b.applied_count) },
                ],
              }))}
            />
          ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-primary/5 hover:bg-primary/5">
                {shown.map((column) => (
                  <TableHead key={column.id} className={TABLE_HEAD_CLASS}>{column.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => (
                <TableRow key={b.id}>
                  {shown.map((column) => {
                    if (column.id === "file") return <TableCell key={column.id} className="font-medium"><TableNameCell name={b.file_name} /></TableCell>;
                    if (column.id === "status") return <TableCell key={column.id}><StatusPill variant={batchVariant(b.status)} dot={false}>{b.status}</StatusPill></TableCell>;
                    if (column.id === "rows") return <TableCell key={column.id} className="tabular-nums">{b.row_count}</TableCell>;
                    if (column.id === "applied") return <TableCell key={column.id} className="tabular-nums">{b.applied_count}{b.skipped_count > 0 ? <span className="text-muted-foreground"> ({t("skipped", { count: b.skipped_count })})</span> : null}</TableCell>;
                    if (column.id === "uploaded") return <TableCell key={column.id} className="text-sm text-muted-foreground">{formatDateTime(b.uploaded_at)}</TableCell>;
                    return <TableCell key={column.id}>{isSuperAdmin && b.status === "applied" ? <Button type="button" variant="outline" size="sm" className="cursor-pointer rounded-lg" onClick={() => { setRevertId(b.id); setRevertName(b.file_name); }}><Undo2 className="me-1 h-3.5 w-3.5" />{t("revert")}</Button> : <EmptyCell />}</TableCell>;
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          )}
        </div>
      )}

      <ConfirmDeleteDialog
        open={Boolean(revertId)}
        onOpenChange={(open) => {
          if (!open) setRevertId(null);
        }}
        itemTitle={t("revertTitle")}
        itemName={revertName}
        confirmText="REVERT"
        warning={t("revertWarning")}
        onConfirm={handleRevert}
        isPending={isPending}
      />
    </AppPage>
  );
}
