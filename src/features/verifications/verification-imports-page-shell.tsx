"use client";

import { useState, useTransition } from "react";
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
          <Table>
            <TableHeader>
              <TableRow className="bg-primary/5 hover:bg-primary/5">
                <TableHead className={TABLE_HEAD_CLASS}>{t("colFile")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colRows")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colApplied")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colUploaded")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.file_name}</TableCell>
                  <TableCell>
                    <StatusPill variant={batchVariant(b.status)} dot={false}>
                      {b.status}
                    </StatusPill>
                  </TableCell>
                  <TableCell className="tabular-nums">{b.row_count}</TableCell>
                  <TableCell className="tabular-nums">
                    {b.applied_count}
                    {b.skipped_count > 0 ? (
                      <span className="text-muted-foreground">
                        {" "}
                        ({t("skipped", { count: b.skipped_count })})
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDateTime(b.uploaded_at)}
                  </TableCell>
                  <TableCell>
                    {isSuperAdmin && b.status === "applied" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="cursor-pointer rounded-lg"
                        onClick={() => {
                          setRevertId(b.id);
                          setRevertName(b.file_name);
                        }}
                      >
                        <Undo2 className="me-1 h-3.5 w-3.5" />
                        {t("revert")}
                      </Button>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
