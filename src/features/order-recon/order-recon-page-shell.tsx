"use client";

import { useMemo, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Download, GitCompareArrows, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppListCard } from "@/components/app/app-list-card";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { queryKeys } from "@/lib/query/query-keys";
import { useAuth } from "@/contexts/auth-context";
import {
  commitOrderRecon,
  getLatestOrderRecon,
  previewOrderRecon,
  type ReconPreview,
} from "./order-recon-actions";
import { buildOrderReconWorkbook, downloadOrderReconXlsx } from "./order-recon-xlsx";
import type { OrderReconTableRow } from "./order-recon-types";

export function OrderReconPageShell() {
  const t = useTranslations("pages.orderRecon");
  const { can } = useAuth();
  const canManage = can("deliveries.manage");
  const queryClient = useQueryClient();
  const { data: latest, isLoading } = useQuery({
    queryKey: queryKeys.orderRecon.latest(),
    queryFn: getLatestOrderRecon,
  });

  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ReconPreview | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isPending, startTransition] = useTransition();
  const [onlyMismatches, setOnlyMismatches] = useState(true);

  const rows = latest?.rows ?? [];
  const visible = useMemo(
    () => (onlyMismatches ? rows.filter((r) => r.status !== "match") : rows),
    [onlyMismatches, rows],
  );

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
        toast.error(t(`errors.${result.error}` as "errors.compare_failed"));
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
        toast.error(t(`errors.${result.error}` as "errors.save_failed"));
        return;
      }
      toast.success(t("committed"));
      setOpen(false);
      setPreview(null);
      setFile(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.orderRecon.latest() });
    });
  };

  const onExport = () => {
    startTransition(async () => {
      const buf = await buildOrderReconWorkbook(rows);
      downloadOrderReconXlsx(buf, `order-recon-${latest?.from_date ?? "export"}.xlsx`);
    });
  };

  const kpi = latest?.kpi;

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-9 cursor-pointer"
              disabled={!latest || rows.length === 0}
              onClick={onExport}
            >
              <Download className="size-4" />
              {t("export")}
            </Button>
            {canManage ? (
              <Button type="button" className="h-9 cursor-pointer" onClick={() => setOpen(true)}>
                <Upload className="size-4" />
                {t("upload")}
              </Button>
            ) : null}
          </div>
        }
      />

      <KpiGrid
        items={[
          { label: t("kpiCompared"), value: kpi?.compared ?? 0 },
          { label: t("kpiMismatches"), value: kpi?.mismatches ?? 0, accent: "danger" },
          { label: t("kpiUnresolved"), value: kpi?.unresolved ?? 0, accent: "warning" },
          { label: t("kpiAppOnly"), value: kpi?.app_only ?? 0 },
        ]}
      />

      <AppListCard
        toolbar={
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {latest
                ? t("runMeta", { file: latest.file_name, from: latest.from_date, to: latest.to_date })
                : t("emptyHint")}
            </p>
            <Button
              type="button"
              variant={onlyMismatches ? "default" : "outline"}
              className="h-9 cursor-pointer"
              onClick={() => setOnlyMismatches((v) => !v)}
            >
              {onlyMismatches ? t("showMismatches") : t("showAll")}
            </Button>
          </div>
        }
      >
        {isLoading ? (
          <div className="flex justify-center p-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <AppDataTable
            columns={[
              { id: "employee", label: t("colEmployee") },
              { id: "restaurant", label: t("colRestaurant") },
              { id: "date", label: t("colDate") },
              { id: "excel", label: t("colExcel") },
              { id: "app", label: t("colApp") },
              { id: "diff", label: t("colDiff") },
            ]}
            empty={
              visible.length === 0 ? <AppDataTableEmpty>{t("emptyRows")}</AppDataTableEmpty> : undefined
            }
          >
            {visible.map((row: OrderReconTableRow) => (
              <AppDataTableRow key={row.id}>
                <TableCell className="px-3 py-2 text-sm">
                  <div className="font-medium">{row.employee_name || "—"}</div>
                  <div className="text-[10px] text-muted-foreground">{row.employee_id}</div>
                </TableCell>
                <TableCell className="px-3 py-2 text-sm">{row.restaurant_name || "—"}</TableCell>
                <TableCell className="px-3 py-2 text-sm">{row.work_date}</TableCell>
                <TableCell className="px-3 py-2 text-sm">{row.excel_orders}</TableCell>
                <TableCell className="px-3 py-2 text-sm">{row.app_orders}</TableCell>
                <TableCell className="px-3 py-2 text-sm font-medium">{row.difference}</TableCell>
              </AppDataTableRow>
            ))}
          </AppDataTable>
        )}
      </AppListCard>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setPreview(null);
            setFile(null);
          }
        }}
      >
        <DialogContent
          showCloseButton
          closeOutside
          className="w-[min(720px,96vw)] overflow-visible p-0 pt-4"
        >
          <div className="space-y-3 px-5 py-4">
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
                  {t("previewReady", { ready: preview.readyCount, unresolved: preview.unresolvedCount })}
                </p>
                {preview.unresolvedCount > 0 ? (
                  <ul className="max-h-40 overflow-auto rounded-lg border border-border p-2">
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
          <AppModalFooter title={t("uploadTitle")} subtitle={t("uploadSubtitle")}>
            <Button
              type="button"
              variant="outline"
              className="h-9 cursor-pointer"
              disabled={isPending}
              onClick={() => setOpen(false)}
            >
              {t("cancel")}
            </Button>
            {preview ? (
              <Button
                type="button"
                className="h-9 cursor-pointer"
                disabled={isPending || preview.readyCount === 0}
                onClick={onCommit}
              >
                <GitCompareArrows className="size-4" />
                {isPending ? t("comparing") : t("commit")}
              </Button>
            ) : (
              <Button
                type="button"
                className="h-9 cursor-pointer"
                disabled={isPending || !file}
                onClick={onPreview}
              >
                {isPending ? t("previewing") : t("preview")}
              </Button>
            )}
          </AppModalFooter>
        </DialogContent>
      </Dialog>
    </AppPage>
  );
}
