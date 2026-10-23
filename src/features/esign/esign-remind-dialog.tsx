"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { esignRecipientStage } from "./esign-recipient-stage";
import { useEsignReminderState, useRemindEsignRequests } from "./use-esign";

/**
 * One rider the drawer can chase.
 *
 * A structural type rather than `EsignListRow` or `EsignBatchLine`: the two
 * callers hold different rows (the tracker has a driver name, the batch detail
 * has a row index) and neither should have to grow the other's fields to open
 * the same drawer. `label` is pre-formatted by the caller for exactly that
 * reason — the drawer prints one line per rider and has no opinion about which
 * of the two shapes produced it.
 */
export type EsignRemindTarget = {
  id: string;
  request_code: string;
  status: string;
  viewed_at: string | null;
  label?: string;
};

/**
 * The reminder drawer — Figma O6.
 *
 * Header title + body + footer (RCM V2 exception: not footer-first). Close sits
 * in the header. SMS and Email stay visible as outline pills and are not
 * wired — App notification is the only live channel.
 *
 * **Only riders who still have work to do are offered.** The caller passes
 * whoever it holds and this filters to the two waiting stages.
 *
 * **The cooldown is the server's number, not a client calculation.** It arrives
 * per recipient from `admin_esign_reminder_state` beside the stored
 * `last_reminded_at`, and the hours are re-read at submit time rather than
 * trusted from the tick.
 *
 * **The selection defaults to everyone eligible, not to nobody.**
 */
export function EsignRemindDialog({
  open,
  onOpenChange,
  recipients,
  onSent,
  subtitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipients: EsignRemindTarget[];
  onSent?: (sent: number) => void;
  subtitle?: string;
}) {
  const t = useTranslations("pages.requests.esign.batchDetail");
  const remind = useRemindEsignRequests();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const preview = t("remindPreviewBody", {
    title: subtitle?.trim() || t("remindTitle"),
  });

  const waiting = useMemo(() => {
    const seen = new Set<string>();
    const out: EsignRemindTarget[] = [];
    for (const row of recipients) {
      if (seen.has(row.id)) continue;
      const stage = esignRecipientStage(row);
      if (stage !== "opened" && stage !== "not_opened") continue;
      seen.add(row.id);
      out.push(row);
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }, [recipients]);
  const ids = useMemo(() => waiting.map((row) => row.id), [waiting]);
  const { data, isLoading } = useEsignReminderState(open ? ids : []);
  const state = data?.state;

  const byId = useMemo(() => {
    const map = new Map<string, { hoursLeft: number; reminderCount: number }>();
    for (const row of state?.rows ?? []) {
      map.set(row.id, { hoursLeft: row.hours_left, reminderCount: row.reminder_count });
    }
    return map;
  }, [state]);

  const selectable = useMemo(
    () => waiting.filter((row) => (byId.get(row.id)?.hoursLeft ?? 0) === 0),
    [waiting, byId],
  );
  const selectionSeed = !open
    ? "closed"
    : state
      ? `ready:${selectable.map((row) => row.id).join(",")}`
      : "pending";
  const [seed, setSeed] = useState("closed");
  if (seed !== selectionSeed) {
    setSeed(selectionSeed);
    setSelected(selectionSeed.startsWith("ready:") ? new Set(selectable.map((row) => row.id)) : new Set());
  }
  const selectedIds = useMemo(
    () => selectable.filter((row) => selected.has(row.id)).map((row) => row.id),
    [selectable, selected],
  );

  async function submit() {
    if (selectedIds.length === 0) return;
    const result = await remind.mutateAsync({ ids: selectedIds, message: preview });
    if (!result.ok) {
      toast.error(result.error ?? t("errors.loadFailed"));
      return;
    }
    if (result.sent === 0) {
      toast.warning(t("cooldownHint", { count: 0, hours: result.cooldownHours }));
    } else if (result.skippedCooldown > 0 || result.skippedStage > 0) {
      toast.success(
        `${t("remindSelected", { count: result.sent })} · ${t("cooldownHint", {
          count: result.skippedCooldown + result.skippedStage,
          hours: result.cooldownHours,
        })}`,
      );
    } else {
      toast.success(t("remindSelected", { count: result.sent }));
    }
    onSent?.(result.sent);
    onOpenChange(false);
  }

  const heading =
    waiting.length === 0 ? t("remindTitle") : t("remindEmployees", { count: waiting.length });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!remind.isPending) onOpenChange(next);
      }}
    >
      <DialogContent
        className="flex max-h-[min(92vh,760px)] w-[min(520px,96vw)] flex-col gap-0 overflow-hidden rounded-xl p-0"
        showCloseButton={!remind.isPending}
        closeOutside={false}
      >
        <DialogHeader className="border-b border-border px-5 py-4 pe-12">
          <DialogTitle className="text-base font-semibold">{heading}</DialogTitle>
          <DialogDescription>{subtitle?.trim() || t("remindSubtitle")}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {isLoading && waiting.length > 0 ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : waiting.length === 0 ? (
            <p className="rounded-lg border border-border bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
              {t("noRemindable")}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {waiting.map((row) => {
                const info = byId.get(row.id);
                const blocked = (info?.hoursLeft ?? 0) > 0;
                const stage = esignRecipientStage(row);
                return (
                  <li
                    key={row.id}
                    className={
                      blocked
                        ? "flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2 opacity-70"
                        : "flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2"
                    }
                  >
                    <Checkbox
                      checked={blocked ? false : selected.has(row.id)}
                      disabled={blocked}
                      className="data-checked:border-[#F04438] data-checked:bg-[#F04438]"
                      onCheckedChange={() => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          return next;
                        });
                      }}
                      aria-label={row.request_code}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{row.label ?? row.request_code}</p>
                      {info && info.reminderCount > 0 ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {t("cooldownHint", {
                            count: info.reminderCount,
                            hours: state?.cooldownHours ?? 0,
                          })}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">
                      {panelStageLabel(stage, t)}
                    </span>
                    {info && info.reminderCount > 0 ? (
                      <span
                        className={
                          blocked
                            ? "shrink-0 rounded-md border border-amber-200 bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800"
                            : "shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-xs font-semibold text-emerald-700"
                        }
                      >
                        {blocked ? `${info.hoursLeft}h` : `${info.reminderCount}×`}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("sendChannels")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <span className="inline-flex h-8 items-center rounded-full bg-zinc-950 px-3 text-xs font-semibold text-white">
                {t("channelApp")}
              </span>
              <span className="inline-flex h-8 items-center rounded-full border border-border bg-card px-3 text-xs text-foreground">
                {t("channelSms")}
              </span>
              <span className="inline-flex h-8 items-center rounded-full border border-border bg-card px-3 text-xs text-foreground">
                {t("channelEmail")}
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("messagePreview")}
            </p>
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm">
              {preview}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 border-t border-border px-5 py-3 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 cursor-pointer rounded-md"
            onClick={() => onOpenChange(false)}
            disabled={remind.isPending}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-9 cursor-pointer rounded-md bg-zinc-950 px-4 text-white hover:bg-zinc-800"
            onClick={() => void submit()}
            disabled={remind.isPending || selectedIds.length === 0}
          >
            {remind.isPending ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {t("sendReminder")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The recipient stage as one short line, reusing the tracker's own labels. */
function panelStageLabel(
  stage: ReturnType<typeof esignRecipientStage>,
  t: ReturnType<typeof useTranslations>,
): string {
  switch (stage) {
    case "opened":
      return t("stageOpened");
    case "not_opened":
      return t("stageNotOpened");
    case "signed":
      return t("stageSigned");
    case "declined":
      return t("stageDeclined");
    case "expired":
      return t("stageExpired");
    case "cancelled":
      return t("stageCancelled");
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
}
