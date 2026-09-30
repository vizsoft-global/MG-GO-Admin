"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { usePurgeAllModuleCount, usePurgeAllRun } from "./use-data-cleanup";
import { purgeBlockerLabel } from "./purge-blockers";
import { purgeAllModuleFor, type PurgeAllEntity } from "./purge-entities";

type PurgeAllDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: PurgeAllEntity;
  /** Known from the caller. `null` makes the dialog resolve it itself. */
  count: number | null;
  blockers: readonly string[];
  onFinished?: () => void;
};

/**
 * Clear all confirmation.
 *
 * Three states, because a blocked module and an unknown module are different
 * answers: while the count resolves the footer is inert, when the database
 * reports a blocker there is no confirm button at all (a disabled destructive
 * button invites a second attempt that also cannot work), and only a clearable
 * module gets the typed phrase.
 */
export function PurgeAllDialog({
  open,
  onOpenChange,
  entity,
  count,
  blockers,
  onFinished,
}: PurgeAllDialogProps) {
  const t = useTranslations("pages.settings.dataCleanup");
  const module = purgeAllModuleFor(entity);
  const needsCount = open && count === null;
  const countQuery = usePurgeAllModuleCount(entity, needsCount);
  const run = usePurgeAllRun();

  const resolvedCount = count ?? countQuery.data?.count ?? null;
  const resolvedBlockers = blockers.length > 0 ? blockers : (countQuery.data?.blockers ?? []);
  const failed = needsCount && countQuery.isError;

  const moduleLabel = module ? t(`modules.${module.entity}`) : entity;
  const noun = module ? t(`clearAll.nouns.${module.entity}`) : entity.toUpperCase();

  const handleRun = useCallback(async () => {
    try {
      const result = await run.mutateAsync(entity);
      if (result.warning) {
        toast.warning(
          t("clearAll.partial", { deleted: result.deleted, error: result.warning }),
        );
      } else if (result.done) {
        toast.success(t("clearAll.success", { count: result.deleted, module: moduleLabel }));
      } else {
        toast.warning(
          t("clearAll.remaining", { deleted: result.deleted, remaining: result.remaining }),
        );
      }
      onFinished?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.purgeFailed"));
    }
  }, [entity, moduleLabel, onFinished, run, t]);

  if (resolvedCount === null || resolvedBlockers.length > 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="flex max-w-md flex-col gap-0 overflow-visible rounded-xl p-0"
          showCloseButton
          closeOutside
        >
          <div className="px-5 pt-4">
            <div className="flex items-center justify-center py-6">
              {failed ? (
                <AlertTriangle className="h-6 w-6 text-destructive" />
              ) : resolvedCount === null ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : null}
            </div>
            {resolvedBlockers.length > 0 ? (
              <ul className="mb-3 space-y-1 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {resolvedBlockers.map((blocker) => (
                  <li key={blocker}>{purgeBlockerLabel(t, blocker)}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <AppModalFooter
            title={t("clearAll.title", { module: moduleLabel })}
            subtitle={
              failed
                ? t("errors.previewFailed")
                : resolvedCount === null
                  ? t("clearAll.counting")
                  : t("clearAll.blockedBody", { module: moduleLabel })
            }
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 cursor-pointer rounded-md"
              onClick={() => onOpenChange(false)}
            >
              {t("clearAll.close")}
            </Button>
          </AppModalFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      itemTitle={t("clearAll.title", { module: moduleLabel })}
      itemName={t("clearAll.itemName", { count: resolvedCount, module: moduleLabel })}
      confirmText={t("clearAll.confirmPhrase", {
        count: resolvedCount,
        noun,
      })}
      warning={t("clearAll.warning")}
      onConfirm={handleRun}
      isPending={run.isPending}
    />
  );
}

type ClearAllModuleButtonProps = {
  entity: PurgeAllEntity;
  className?: string;
  /** Icon-only for dense toolbars; label collapses under `md` regardless. */
  compact?: boolean;
};

/**
 * Clear all for one list page. Renders nothing at all when the operator does
 * not hold that module's `*.bulk_delete` tick, so the button can never appear
 * where the database would refuse it.
 */
export function ClearAllModuleButton({
  entity,
  className,
  compact = false,
}: ClearAllModuleButtonProps) {
  const t = useTranslations("pages.settings.dataCleanup");
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const module = purgeAllModuleFor(entity);

  if (!module || !can(module.slug)) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={`h-9 shrink-0 cursor-pointer rounded-lg px-2.5 text-destructive hover:bg-destructive/10 hover:text-destructive ${className ?? ""}`}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4" />
        {compact ? null : (
          <span className="ms-1.5 hidden md:inline">{t("clearAll.button")}</span>
        )}
      </Button>
      <PurgeAllDialog
        open={open}
        onOpenChange={setOpen}
        entity={entity}
        count={null}
        blockers={[]}
      />
    </>
  );
}
