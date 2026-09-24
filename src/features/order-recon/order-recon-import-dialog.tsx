"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Download,
  ExternalLink,
  FilePlus2,
  GitCompareArrows,
  History,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { SegmentOption } from "@/components/app/toggle-chip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { queryKeys } from "@/lib/query/query-keys";
import {
  commitOrderRecon,
  getOrderRecon,
  listOrderReconRuns,
  previewOrderRecon,
  redoOrderReconImport,
  undoOrderReconImport,
  type ReconPreview,
} from "./order-recon-actions";
import { downloadOrderReconTemplate, reconTemplateColumns } from "./order-recon-template";
import { redoTargetId, undoTargetId } from "./recon-import-stack";

const KNOWN_ERRORS = new Set([
  "missing_file",
  "invalid_headers",
  "no_date_columns",
  "range_too_large",
  "compare_failed",
  "save_failed",
  "not_authorized",
  "nothing_to_undo",
  "nothing_to_redo",
]);

export function OrderReconImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.orderRecon");
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<"new" | "history">("new");
  const [logRunId, setLogRunId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReconPreview | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pending, startTransition] = useTransition();

  const runs = useQuery({
    queryKey: queryKeys.orderRecon.runs(),
    queryFn: listOrderReconRuns,
    enabled: open,
  });
  const log = useQuery({
    queryKey: queryKeys.orderRecon.importRows(logRunId ?? ""),
    queryFn: () => getOrderRecon(logRunId ?? ""),
    enabled: open && Boolean(logRunId),
  });

  const tips = (runs.data ?? []).map((run) => ({
    id: run.id,
    status: run.status,
    createdAt: run.created_at,
    undoSeq: run.undo_seq,
    redoable: run.redoable,
  }));
  const canUndo = Boolean(undoTargetId(tips));
  const canRedo = Boolean(redoTargetId(tips));
  const columns = reconTemplateColumns();

  const reset = () => {
    setPreview(null);
    setFile(null);
    setLogRunId(null);
    setPanel("new");
  };

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.orderRecon.latest() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.orderRecon.runs() }),
    ]);
  };

  const message = (code: string) =>
    KNOWN_ERRORS.has(code) ? t(`errors.${code}` as "errors.compare_failed") : code;

  const onPreview = () => {
    if (!file) {
      toast.error(t("errors.missing_file"));
      return;
    }
    const fd = new FormData();
    fd.set("file", file);
    startTransition(async () => {
      const result = await previewOrderRecon(fd);
      if ("error" in result) {
        toast.error(message(result.error));
        return;
      }
      setPreview(result.preview);
    });
  };

  const onCommit = () => {
    if (!preview) return;
    startTransition(async () => {
      const result = await commitOrderRecon(preview);
      if ("error" in result) {
        toast.error(message(result.error));
        return;
      }
      toast.success(t("committed"));
      onOpenChange(false);
      reset();
      await refresh();
    });
  };

  const undo = () => {
    startTransition(async () => {
      const result = await undoOrderReconImport();
      if (result.error) {
        toast.error(message(result.error));
        return;
      }
      toast.success(t("undone"));
      await refresh();
    });
  };

  const redo = () => {
    startTransition(async () => {
      const result = await redoOrderReconImport();
      if (result.error) {
        toast.error(message(result.error));
        return;
      }
      toast.success(t("redone"));
      await refresh();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent
        showCloseButton
        closeOutside
        className="flex max-h-[min(92vh,880px)] w-[min(1200px,96vw)] max-w-none flex-col gap-0 overflow-visible rounded-xl p-0 pt-4 sm:max-w-[min(1200px,96vw)]"
      >
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-3">
          {logRunId ? (
            <LogTable
              rows={log.data?.rows ?? []}
              loading={log.isLoading}
              onBack={() => setLogRunId(null)}
            />
          ) : (
            <>
              <div className="flex gap-1" role="radiogroup">
                <SegmentOption
                  selected={panel === "new"}
                  variant="success"
                  onClick={() => setPanel("new")}
                >
                  <FilePlus2 className="h-3.5 w-3.5" />
                  {t("newImport")}
                </SegmentOption>
                <SegmentOption
                  selected={panel === "history"}
                  variant="success"
                  onClick={() => setPanel("history")}
                >
                  <History className="h-3.5 w-3.5" />
                  {t("previousImports")}
                </SegmentOption>
              </div>
              {panel === "new" ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold">{t("columnDetails")}</p>
                        <p className="text-[10px] text-muted-foreground">{t("columnDetailsHint")}</p>
                      </div>
                      <Button
                        type="button"
                        className="h-9 cursor-pointer bg-emerald-600 text-white hover:bg-emerald-700"
                        onClick={() => void downloadOrderReconTemplate()}
                      >
                        <Download className="me-2 h-3.5 w-3.5" />
                        {t("downloadTemplate")}
                      </Button>
                    </div>
                    <div className="mt-3 overflow-x-auto rounded-lg border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className={TABLE_HEAD_CLASS}>{t("colColumn")}</TableHead>
                            <TableHead className={TABLE_HEAD_CLASS}>{t("colRequired")}</TableHead>
                            <TableHead className={TABLE_HEAD_CLASS}>{t("colExample")}</TableHead>
                            <TableHead className={TABLE_HEAD_CLASS}>{t("colNotes")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {columns.map((col) => (
                            <TableRow key={col.header}>
                              <TableCell className="text-xs font-medium">{col.header}</TableCell>
                              <TableCell className="text-xs">
                                {col.required ? t("requiredYes") : t("requiredNo")}
                              </TableCell>
                              <TableCell className="text-xs">{col.example}</TableCell>
                              <TableCell className="text-[10px] text-muted-foreground">
                                {col.notes}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="recon-file">{t("fileLabel")}</Label>
                    <Input
                      id="recon-file"
                      type="file"
                      accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      className="h-9"
                      onChange={(e) => {
                        setFile(e.target.files?.[0] ?? null);
                        setPreview(null);
                      }}
                    />
                  </div>
                  {preview ? (
                    <div className="space-y-1 text-xs">
                      <p>
                        {t("previewReady", {
                          ready: preview.readyCount,
                          unresolved: preview.unresolvedCount,
                        })}
                      </p>
                      {preview.unresolvedCount > 0 ? (
                        <ul className="max-h-32 overflow-auto rounded-lg border border-border p-2">
                          {preview.resolved
                            .filter((r) => r.status === "unresolved")
                            .slice(0, 40)
                            .map((r, i) => (
                              <li key={`${r.employee_id}-${r.store_name}-${i}`}>
                                {r.employee_id || "—"} · {r.store_name || "—"} · {r.unresolved_reason}
                              </li>
                            ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <HistoryTable
                  rows={runs.data ?? []}
                  loading={runs.isLoading}
                  onView={setLogRunId}
                />
              )}
            </>
          )}
        </div>
        <div className="px-5 pb-4">
          <AppModalFooter title={t("uploadTitle")} subtitle={t("uploadSubtitle")}>
            {logRunId ? (
              <Button type="button" variant="outline" className="h-9" onClick={() => setLogRunId(null)}>
                {t("back")}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  disabled={!canUndo || pending}
                  onClick={undo}
                >
                  {t("undo")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  disabled={!canRedo || pending}
                  onClick={redo}
                >
                  {t("redo")}
                </Button>
                {panel === "new" ? (
                  preview ? (
                    <Button
                      type="button"
                      className="h-9 cursor-pointer"
                      disabled={pending || preview.readyCount === 0}
                      onClick={onCommit}
                    >
                      <GitCompareArrows className="size-4" />
                      {pending ? t("comparing") : t("commit")}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      className="h-9 cursor-pointer"
                      disabled={pending || !file}
                      onClick={onPreview}
                    >
                      {pending ? <Loader2 className="me-2 h-3.5 w-3.5 animate-spin" /> : null}
                      {pending ? t("previewing") : t("preview")}
                    </Button>
                  )
                ) : null}
              </>
            )}
          </AppModalFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HistoryTable({
  rows,
  loading,
  onView,
}: {
  rows: Awaited<ReturnType<typeof listOrderReconRuns>>;
  loading: boolean;
  onView: (id: string) => void;
}) {
  const t = useTranslations("pages.orderRecon");
  if (loading) {
    return (
      <div className="flex justify-center p-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!rows.length) return <p className="text-xs text-muted-foreground">{t("historyEmpty")}</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={TABLE_HEAD_CLASS}>{t("colFile")}</TableHead>
            <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
            <TableHead className={TABLE_HEAD_CLASS}>{t("colWhen")}</TableHead>
            <TableHead className={TABLE_HEAD_CLASS}>{t("colRange")}</TableHead>
            <TableHead className={TABLE_HEAD_CLASS}>{t("colActions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="text-xs">{row.file_name}</TableCell>
              <TableCell className="text-xs">{t(`importStatus.${row.status}`)}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {new Date(row.created_at).toLocaleString()}
              </TableCell>
              <TableCell className="text-xs">
                {row.from_date} – {row.to_date}
              </TableCell>
              <TableCell>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 cursor-pointer px-2 text-primary hover:bg-primary/10"
                  onClick={() => onView(row.id)}
                >
                  <ExternalLink className="me-1 h-3.5 w-3.5" />
                  {t("viewImport")}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function LogTable({
  rows,
  loading,
  onBack,
}: {
  rows: NonNullable<Awaited<ReturnType<typeof getOrderRecon>>>["rows"];
  loading: boolean;
  onBack: () => void;
}) {
  const t = useTranslations("pages.orderRecon");
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" className="h-9" onClick={onBack}>
        {t("back")}
      </Button>
      {loading ? <p className="text-xs text-muted-foreground">{t("loading")}</p> : null}
      <div className="max-h-[360px] overflow-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colEmployee")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colRestaurant")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colDate")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colExcel")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colApp")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-xs">
                  {row.employee_name || row.employee_id || "—"}
                  {row.employee_id ? (
                    <div className="text-[10px] text-muted-foreground">{row.employee_id}</div>
                  ) : null}
                </TableCell>
                <TableCell className="text-xs">{row.restaurant_name || "—"}</TableCell>
                <TableCell className="text-xs">{row.work_date}</TableCell>
                <TableCell className="text-xs">{row.excel_orders}</TableCell>
                <TableCell className="text-xs">{row.app_orders}</TableCell>
                <TableCell className="text-xs">{statusLabel(t, row.status)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function statusLabel(
  t: ReturnType<typeof useTranslations>,
  status: string,
) {
  if (status === "match") return t("statusMatch");
  if (status === "mismatch") return t("statusMismatch");
  if (status === "unresolved") return t("statusUnresolved");
  if (status === "app_only") return t("statusAppOnly");
  return status;
}
