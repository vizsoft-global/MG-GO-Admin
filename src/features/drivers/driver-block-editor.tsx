"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusPill } from "@/components/dashboard/status-pill";
import { invalidateDriverCaches } from "./invalidate-driver-caches";
import { setDriverBlocked } from "./drivers-actions";
import { isDriverErrorKey } from "./driver-errors";
import { blockActionToastKind } from "./driver-workflow-ui";

export function DriverBlockEditor({
  driverId,
  intakeId,
  isBlocked,
  blockedReason,
  blockedAt,
  canManage,
}: {
  driverId: string;
  intakeId?: string | null;
  isBlocked: boolean;
  blockedReason: string | null;
  blockedAt: string | null;
  canManage: boolean;
}) {
  const t = useTranslations("pages.driverDetail.block");
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [unblockOpen, setUnblockOpen] = useState(false);
  const [reason, setReason] = useState(blockedReason ?? "");
  const [isPending, startTransition] = useTransition();

  const errorMessage = (error: string | undefined) => {
    const key = isDriverErrorKey(error) ? error : "save_failed";
    return t(`errors.${key}` as "errors.save_failed");
  };

  const submitBlock = () => {
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      toast.error(t("reasonRequired"));
      return;
    }

    startTransition(async () => {
      const result = await setDriverBlocked(driverId, true, trimmed);
      if ("error" in result) {
        toast.error(errorMessage(result.error));
        return;
      }
      if (blockActionToastKind(true) === "warning") {
        toast.warning(t("blocked"), { icon: <Ban className="size-4" /> });
      } else {
        toast.success(t("blocked"));
      }
      setDialogOpen(false);
      await invalidateDriverCaches(queryClient, { intakeId, profileId: driverId });
    });
  };

  const submitUnblock = () => {
    startTransition(async () => {
      const result = await setDriverBlocked(driverId, false);
      if ("error" in result) {
        toast.error(errorMessage(result.error));
        return;
      }
      if (blockActionToastKind(false) === "success") {
        toast.success(t("unblocked"));
      } else {
        toast.warning(t("unblocked"));
      }
      setReason("");
      setUnblockOpen(false);
      await invalidateDriverCaches(queryClient, { intakeId, profileId: driverId });
    });
  };

  const onToggle = (checked: boolean) => {
    if (!canManage || isPending) return;
    if (checked) {
      setReason(blockedReason ?? "");
      setDialogOpen(true);
      return;
    }
    setUnblockOpen(true);
  };

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="driver-block-toggle">{t("label")}</Label>
          <StatusPill variant={isBlocked ? "danger" : "success"} dot={false}>
            {isBlocked ? t("statusBlocked") : t("statusAllowed")}
          </StatusPill>
        </div>

        <p className="text-xs text-muted-foreground">{t("hint")}</p>

        {isBlocked && blockedReason ? (
          <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-destructive">
              {t("reasonLabel")}
            </p>
            <p className="mt-1 text-sm text-foreground">{blockedReason}</p>
            {blockedAt ? (
              <p className="mt-2 text-[10px] text-muted-foreground">
                {t("blockedAt", { date: new Date(blockedAt).toLocaleString() })}
              </p>
            ) : null}
          </div>
        ) : null}

        {canManage ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/10 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <Ban className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium">{t("toggle")}</span>
            </div>
            <Switch
              id="driver-block-toggle"
              checked={isBlocked}
              disabled={isPending}
              onCheckedChange={onToggle}
            />
          </div>
        ) : null}

        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="flex max-h-[min(90vh,480px)] w-[min(480px,96vw)] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle className="text-base">{t("dialogTitle")}</DialogTitle>
            <DialogDescription>{t("dialogDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 px-5 py-4">
            <Label htmlFor="driver-block-reason">{t("reasonField")}</Label>
            <Textarea
              id="driver-block-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("reasonPlaceholder")}
              rows={4}
              disabled={isPending}
              className="min-h-[96px] resize-none"
            />
            <p className="text-[10px] text-muted-foreground">{t("reasonHint")}</p>
          </div>
          <DialogFooter className="border-t border-border px-5 py-3">
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer"
              disabled={isPending}
              onClick={() => setDialogOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="cursor-pointer"
              disabled={isPending}
              onClick={submitBlock}
            >
              {isPending ? t("blocking") : t("confirmBlock")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={unblockOpen} onOpenChange={setUnblockOpen}>
        <DialogContent
          showCloseButton
          closeOutside
          className="w-[min(480px,96vw)] overflow-visible p-0 pt-4"
        >
          <div className="px-2 pb-2">
            <AppModalFooter
              title={t("unblockDialogTitle")}
              subtitle={t("unblockDialogDescription")}
            >
              <Button
                type="button"
                variant="outline"
                className="h-9 cursor-pointer"
                disabled={isPending}
                onClick={() => setUnblockOpen(false)}
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                className="h-9 cursor-pointer"
                disabled={isPending}
                onClick={submitUnblock}
              >
                {isPending ? t("unblocking") : t("confirmUnblock")}
              </Button>
            </AppModalFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
