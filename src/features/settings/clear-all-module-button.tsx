"use client";

import { useCallback, useMemo, useState } from "react";
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
import { runSelectedPurge } from "./data-cleanup-actions";

/** Rounds of the batched delete; each round removes the callable's own limit. */
const SELECTED_PURGE_MAX_ROUNDS = 25;

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
 * Module-wide clear, for Settings → Data cleanup only.
 *
 * List pages must not use this: their Clear all acts on the ticked rows, see
 * `ClearAllModuleButton`. Three states, because a blocked module and an unknown
 * module are different answers: while the count resolves the footer is inert,
 * when the database reports a blocker there is no confirm button at all (a
 * disabled destructive button invites a second attempt that also cannot work),
 * and only a clearable module gets the typed phrase.
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

type PurgeSelectedDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: PurgeAllEntity;
  ids: readonly string[];
  /** Module-specific delete. Defaults to the shared `adminPurgeSelected`. */
  onClear?: (ids: string[]) => Promise<void> | void;
  onFinished?: () => void;
};

/**
 * Clear all on a list page: delete the ticked rows and nothing else.
 *
 * The run is bounded by the selection at every layer — the ids come from the
 * table, the callable intersects them with the rows this entity owns, and the
 * loop stops when the selection is empty — so no code path here can widen the
 * delete to the module.
 */
function PurgeSelectedDialog({
  open,
  onOpenChange,
  entity,
  ids,
  onClear,
  onFinished,
}: PurgeSelectedDialogProps) {
  const t = useTranslations("pages.settings.dataCleanup");
  const tCommon = useTranslations("common");
  const module = purgeAllModuleFor(entity);
  const [pending, setPending] = useState(false);

  const moduleLabel = module ? t(`modules.${module.entity}`) : entity;
  const count = ids.length;

  const handleConfirm = useCallback(async () => {
    if (count === 0 || pending) return;
    setPending(true);
    let deleted = 0;
    try {
      if (onClear) {
        await onClear([...ids]);
        deleted = count;
      } else {
        let blockers: string[] = [];
        for (let round = 0; round < SELECTED_PURGE_MAX_ROUNDS; round += 1) {
          const result = await runSelectedPurge(entity, [...ids]);
          deleted += result.deleted;
          blockers = result.blockers;
          if (blockers.length > 0 || result.remaining === 0 || result.deleted === 0) break;
        }
        if (blockers.length > 0) {
          toast.error(blockers.map((blocker) => purgeBlockerLabel(t, blocker)).join(" "));
          return;
        }
      }

      if (deleted === 0) {
        toast.warning(t("clearAll.selected.nothing"));
      } else if (deleted < count) {
        toast.warning(
          t("clearAll.selected.remaining", { deleted, remaining: count - deleted }),
        );
      } else {
        toast.success(
          t("clearAll.selected.success", { count: deleted, module: moduleLabel }),
        );
      }
      onOpenChange(false);
      onFinished?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.purgeFailed"));
    } finally {
      setPending(false);
    }
  }, [count, entity, ids, moduleLabel, onClear, onFinished, onOpenChange, pending, t]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton closeOutside className="w-[min(560px,96vw)]">
        <div className="space-y-3 pt-4">
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
            <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-xs leading-snug text-destructive">
              {t("clearAll.selected.warning")}
            </p>
          </div>
          <AppModalFooter
            title={t("clearAll.selected.title", { module: moduleLabel })}
            subtitle={t("clearAll.selected.body", { count })}
            meta={
              <span className="inline-flex items-center gap-1.5">
                <span className="rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-semibold text-primary">
                  {t("clearAll.selected.itemName", { count, module: moduleLabel })}
                </span>
              </span>
            }
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9"
              disabled={pending || count === 0}
              onClick={() => void handleConfirm()}
            >
              {pending ? t("clearAll.selected.working") : t("clearAll.selected.confirm", { count })}
            </Button>
          </AppModalFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export type ClearAllModuleButtonProps = {
  entity: PurgeAllEntity;
  /** Ids ticked in the table. Absent or empty means nothing is selected. */
  selectedIds?: ReadonlySet<string> | readonly string[];
  /** Module-specific delete for this entity's selected records. */
  onClear?: (ids: string[]) => Promise<void> | void;
  /** Drop the selection and refetch after a run. */
  onSuccess?: () => void;
  className?: string;
  /** Icon-only for dense toolbars; label collapses under `md` regardless. */
  compact?: boolean;
};

/**
 * Whether this operator may clear one module at all.
 *
 * List pages use it to decide whether to draw a selection column: a table the
 * operator cannot clear needs no checkboxes, and a table that can be cleared
 * must offer them or the button could only ever answer "select a record first".
 */
export function useCanClearAll(entity: PurgeAllEntity) {
  const { can } = useAuth();
  const module = purgeAllModuleFor(entity);
  return Boolean(module && can(module.slug));
}

/**
 * Clear all for one list page. Renders nothing at all when the operator does
 * not hold that module's `*.bulk_delete` tick, so the button can never appear
 * where the database would refuse it, and it never deletes anything the user
 * has not ticked.
 */
export function ClearAllModuleButton({
  entity,
  selectedIds,
  onClear,
  onSuccess,
  className,
  compact = false,
}: ClearAllModuleButtonProps) {
  const t = useTranslations("pages.settings.dataCleanup");
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const module = purgeAllModuleFor(entity);

  const ids = useMemo(() => {
    if (!selectedIds) return [] as string[];
    const list = Array.isArray(selectedIds) ? selectedIds : [...selectedIds];
    return [...new Set(list.filter((id): id is string => typeof id === "string" && id.length > 0))];
  }, [selectedIds]);

  if (!module || !can(module.slug)) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={compact ? "icon" : "sm"}
        className={`h-9 shrink-0 cursor-pointer rounded-lg text-destructive hover:bg-destructive/10 hover:text-destructive ${compact ? "w-9" : "px-2.5"} ${className ?? ""}`}
        onClick={() => {
          if (ids.length === 0) {
            toast.warning(t("clearAll.selected.selectFirst"));
            return;
          }
          setOpen(true);
        }}
        aria-label={t("clearAll.button")}
      >
        <Trash2 className="h-4 w-4" />
        {compact ? null : (
          <span className="ms-1.5 hidden md:inline">{t("clearAll.button")}</span>
        )}
      </Button>
      <PurgeSelectedDialog
        open={open}
        onOpenChange={setOpen}
        entity={entity}
        ids={ids}
        onClear={onClear}
        onFinished={onSuccess}
      />
    </>
  );
}
