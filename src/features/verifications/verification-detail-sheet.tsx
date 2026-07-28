"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/components/dashboard/status-pill";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/contexts/auth-context";
import {
  useDeleteVerification,
  useReconcileVerification,
  useUpdateVerification,
  useVerificationDetail,
} from "./use-verifications";
import { resolveStatusVariant } from "@/lib/ui/resolve-status-variant";
import type { VerificationListRow, VerificationStatus } from "./types";

function formatKuwaitDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeZone: "Asia/Kuwait",
    }).format(new Date(`${iso}T12:00:00Z`));
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kuwait",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function VerificationDetailSheet({
  row,
  open,
  onOpenChange,
}: {
  row: VerificationListRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.verifications");
  const { isSuperAdmin } = useAuth();
  const [reportedCount, setReportedCount] = useState("");
  const [notes, setNotes] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const { data: detail, isLoading } = useVerificationDetail(row?.id ?? null);
  const update = useUpdateVerification();
  const reconcile = useReconcileVerification();
  const remove = useDeleteVerification();

  useEffect(() => {
    if (detail) {
      setReportedCount(String(detail.reported_count));
      setNotes(detail.notes ?? "");
    } else if (row) {
      setReportedCount(String(row.reported_count));
      setNotes(row.notes ?? "");
    }
  }, [detail, row]);

  const display = detail ?? row;
  if (!display) return null;

  const handleSave = () => {
    const count = parseInt(reportedCount, 10);
    if (!Number.isFinite(count) || count < 0) {
      toast.error(t("errors.invalidCount"));
      return;
    }
    startTransition(async () => {
      const result = await update.mutateAsync({
        id: display.id,
        reportedCount: count,
        notes,
      });
      if ("error" in result) {
        toast.error(t("errors.save_failed"), {
          description: result.errorDetail,
          duration: result.errorDetail ? 9000 : undefined,
        });
        return;
      }
      toast.success(t("updateSuccess"));
    });
  };

  const handleReconcile = () => {
    startTransition(async () => {
      const result = await reconcile.mutateAsync(display.id);
      if ("error" in result) {
        toast.error(t("errors.reconcile_failed"), {
          description: result.errorDetail,
          duration: result.errorDetail ? 9000 : undefined,
        });
        return;
      }
      toast.success(t("reconcileSuccess"));
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      const result = await remove.mutateAsync(display.id);
      if ("error" in result) {
        toast.error(t("errors.delete_failed"), {
          description: result.errorDetail,
          duration: result.errorDetail ? 9000 : undefined,
        });
        return;
      }
      toast.success(t("deleteSuccess"));
      setDeleteOpen(false);
      onOpenChange(false);
    });
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t("detailTitle")}</SheetTitle>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <StatusPill variant={resolveStatusVariant(display.status)} dot={false}>
                {t(`status.${display.status}`)}
              </StatusPill>
              <span className="text-sm text-muted-foreground">
                {formatKuwaitDate(display.service_date)}
              </span>
            </div>
          </SheetHeader>
          <SheetBody>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <dl className="grid gap-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground">{t("fieldDriver")}</dt>
                    <dd className="font-medium">
                      {display.driver_name} · {display.driver_code}
                      {display.employee_id ? ` · ${display.employee_id}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t("fieldRestaurant")}</dt>
                    <dd className="font-medium">{display.restaurant_name}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t("colPartner")}</dt>
                    <dd className="font-medium">{display.partner_name}</dd>
                  </div>
                  <div className="flex gap-4 tabular-nums">
                    <div>
                      <dt className="text-muted-foreground">{t("reported")}</dt>
                      <dd>{display.reported_count}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t("matched")}</dt>
                      <dd>{display.matched_count}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t("underReview")}</dt>
                      <dd>{display.under_review_count}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t("shortfall")}</dt>
                      <dd>{display.shortfall_count}</dd>
                    </div>
                  </div>
                  {detail ? (
                    <div>
                      <dt className="text-muted-foreground">{t("balance")}</dt>
                      <dd className="font-medium tabular-nums">{detail.balance_count}</dd>
                    </div>
                  ) : null}
                </dl>

                <div className="space-y-3 rounded-lg border border-border p-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-reported">{t("fieldReported")}</Label>
                    <Input
                      id="edit-reported"
                      type="number"
                      min={0}
                      value={reportedCount}
                      onChange={(e) => setReportedCount(e.target.value)}
                      className="rounded-lg tabular-nums"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-notes">{t("fieldNotes")}</Label>
                    <Input
                      id="edit-notes"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="rounded-lg"
                    />
                  </div>
                </div>

                {detail && detail.deliveries.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("linkedDeliveries")}
                    </p>
                    <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2 text-xs">
                      {detail.deliveries.map((d) => (
                        <li
                          key={d.id}
                          className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-2 py-1"
                        >
                          <span className="font-mono">{d.short_id}</span>
                          <StatusPill variant="neutral" dot={false}>
                            {d.status}
                          </StatusPill>
                          <span className="text-muted-foreground">
                            {d.delivered_at ? formatDateTime(d.delivered_at) : "—"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
          </SheetBody>
          <SheetFooter className="flex-wrap justify-start gap-2">
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer rounded-lg"
              disabled={isPending}
              onClick={handleReconcile}
            >
              {t("reconcileNow")}
            </Button>
            <Button
              type="button"
              className="cursor-pointer rounded-lg"
              disabled={isPending}
              onClick={handleSave}
            >
              {t("save")}
            </Button>
            {isSuperAdmin ? (
              <Button
                type="button"
                variant="destructive"
                className="cursor-pointer rounded-lg"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="h-4 w-4" />
                {t("delete")}
              </Button>
            ) : null}
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        itemTitle={t("deleteTitle")}
        itemName={`${display.driver_name} · ${formatKuwaitDate(display.service_date)}`}
        confirmText={display.id.slice(0, 8).toUpperCase()}
        warning={t("deleteWarning")}
        onConfirm={handleDelete}
        isPending={isPending}
      />
    </>
  );
}
