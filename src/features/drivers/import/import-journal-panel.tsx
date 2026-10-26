"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ExternalLink, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { driverDetailHref } from "../drivers-list-query";
import {
  listDriverImportJournal,
  redoDriverImport,
  redoDriverImportRows,
  undoDriverImport,
  undoDriverImportRows,
  type DriverImportJournalLine,
} from "./driver-import-replay-actions";

export function ImportJournalPanel({ batchId }: { batchId: string }) {
  const t = useTranslations("pages.drivers.import");
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const journal = useQuery({
    queryKey: queryKeys.drivers.importJournal(batchId),
    queryFn: () => listDriverImportJournal(batchId),
  });
  const lines = journal.data ?? [];
  const selected = lines.filter((line) => picked.has(line.rowIndex));
  const one = selected.length === 1 ? selected[0] : null;
  const recordId = one?.driverId ?? one?.intakeId ?? null;

  const finish = async (
    result: { success: true; count: number } | { error: string },
    doneKey: "rowsUndone" | "rowsRedone",
  ) => {
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success(t(doneKey, { count: result.count }));
    setPicked(new Set());
    await queryClient.invalidateQueries({ queryKey: queryKeys.drivers.importJournal(batchId) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.drivers.all() });
  };

  const run = async (work: () => Promise<{ success: true; count: number } | { error: string }>, key: "rowsUndone" | "rowsRedone") => {
    setBusy(true);
    try {
      await finish(await work(), key);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (line: DriverImportJournalLine, on: boolean) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(line.rowIndex);
      else next.delete(line.rowIndex);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t("journalTitle")}</p>
      {lines.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">{t("journalEmpty")}</p>
      ) : (
        <div className="max-h-40 overflow-auto rounded-lg border border-border">
          <table className="w-full text-left text-xs">
            <tbody>
              {lines.map((line) => (
                <tr key={line.rowIndex} className="border-t border-border/60">
                  <td className="w-8 px-2 py-1">
                    <Checkbox
                      className="cursor-pointer"
                      checked={picked.has(line.rowIndex)}
                      aria-label={line.employeeId || line.name || String(line.rowIndex)}
                      onCheckedChange={(checked) => toggle(line, checked === true)}
                    />
                  </td>
                  <td className="px-2 py-1 tabular-nums">{line.employeeId || "—"}</td>
                  <td className="px-2 py-1">{line.name || "—"}</td>
                  <td className="px-2 py-1">
                    {line.replay === "undone" ? t("replayUndone") : t("replayApplied")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          disabled={busy || selected.length === 0}
          onClick={() =>
            void run(
              () => undoDriverImportRows(batchId, selected.map((line) => line.rowIndex)),
              "rowsUndone",
            )
          }
        >
          {t("undoSelected")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          disabled={busy || selected.length === 0}
          onClick={() =>
            void run(
              () => redoDriverImportRows(batchId, selected.map((line) => line.rowIndex)),
              "rowsRedone",
            )
          }
        >
          {t("redoSelected")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          disabled={busy}
          onClick={() => void run(() => undoDriverImport(), "rowsUndone")}
        >
          {t("undo")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          disabled={busy}
          onClick={() => void run(() => redoDriverImport(), "rowsRedone")}
        >
          {t("redo")}
        </Button>
        {recordId ? (
          <Link
            href={driverDetailHref(recordId)}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-9 text-primary hover:bg-primary/10")}
          >
            <ExternalLink className="me-1.5 h-3.5 w-3.5" />
            {t("viewSelected")}
          </Link>
        ) : (
          <Button type="button" variant="ghost" size="sm" className="h-9 text-primary" disabled>
            <ExternalLink className="me-1.5 h-3.5 w-3.5" />
            {t("viewSelected")}
          </Button>
        )}
        {recordId ? (
          <Link
            href={`${driverDetailHref(recordId)}?edit=1`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9")}
          >
            <Pencil className="me-1.5 h-3.5 w-3.5" />
            {t("editSelected")}
          </Link>
        ) : (
          <Button type="button" variant="outline" size="sm" className="h-9" disabled>
            <Pencil className="me-1.5 h-3.5 w-3.5" />
            {t("editSelected")}
          </Button>
        )}
      </div>
    </div>
  );
}
