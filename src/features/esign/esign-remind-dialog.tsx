"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { BellRing, Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
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
 * The reminder drawer — reference panel D3.
 *
 * **Only riders who still have work to do are offered.** The caller passes
 * whoever it holds and this filters to the two waiting stages, because the
 * alternative — listing everyone and disabling the ones who signed — asks the
 * operator to read forty names to find the four that matter.
 *
 * **The cooldown is the server's number, not a client calculation.** It arrives
 * per recipient from `admin_esign_reminder_state` beside the stored
 * `last_reminded_at`, and the hours are re-read at submit time rather than
 * trusted from the tick, so a rider on another operator's screen is closed here
 * too. A locally-derived cooldown would let two operators each send the same
 * rider a reminder because neither could see the other's write — which is
 * exactly what the ledger exists to prevent. `remindEligibility` in
 * `esign-tracker.ts` still holds the rule for callers with no state fetch (the
 * tracker's per-row badge); this screen reads the authoritative copy instead.
 *
 * **The selection defaults to everyone eligible, not to nobody.** The common
 * case is "chase the whole batch", and a drawer that opens with nothing ticked
 * makes the operator perform the default action by hand every time. A mistaken
 * bulk send is caught by the count on the primary button before it is pressed.
 */
export function EsignRemindDialog({
  open,
  onOpenChange,
  recipients,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipients: EsignRemindTarget[];
  onSent?: (sent: number) => void;
}) {
  const t = useTranslations("pages.requests.esign.batchDetail");
  const remind = useRemindEsignRequests();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");

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
    // Sorted so the query key below is stable: `useEsignReminderState` keys on
    // a join of the ids, and an unchanged set in a different order would
    // otherwise be a different key and re-request the same rows.
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

  // `state` is undefined on the opening paint, so every row reads as eligible
  // until the cooldown arrives. That is the safe direction — the server refuses
  // an inside-window id and reports it as skipped, so an over-broad tick cannot
  // send a reminder the cooldown forbids; the submit filters again anyway.
  const cooling = (id: string) => (byId.get(id)?.hoursLeft ?? 0) > 0;
  const selectable = useMemo(() => waiting.filter((row) => !cooling(row.id)), [waiting, byId]);
  const selectedIds = useMemo(
    () => selectable.filter((row) => selected.has(row.id)).map((row) => row.id),
    [selectable, selected],
  );

  /**
   * Reset the selection whenever the drawer opens, keyed on `open` and the
   * recipient set rather than on the cooldown map: a background refetch that
   * moves a row into cooldown must not silently re-tick a rider the operator
   * had just unticked, which would send exactly the reminder they removed.
   */
  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ids.join(",")]);

  /**
   * Tick everyone eligible once the cooldown is known.
   *
   * Waiting for `state` rather than ticking every waiting row on open is what
   * keeps a rider already inside the window from being ticked and then greyed
   * out a beat later — the drawer would appear to change its mind about who it
   * was about to email, on the one screen where that matters. The submit
   * carries no cooldown logic of its own because `selectedIds` is already
   * filtered through `selectable`, so this effect and the button are the same
   * rule stated once.
   */
  useEffect(() => {
    if (!open || !state) return;
    setSelected(
      new Set(
        waiting
          .filter((row) => (byId.get(row.id)?.hoursLeft ?? 0) === 0)
          .map((row) => row.id),
      ),
    );
    // `waiting` and `byId` are rebuilt from `state`, so they are deliberately
    // not dependencies — including them would re-run this on every render and
    // fight the operator's own ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, state]);

  const allSelected = selectable.length > 0 && selectedIds.length === selectable.length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectable.map((row) => row.id)));
  }

  async function submit() {
    // Re-filtered at submit rather than trusted from state: the cooldown can
    // expire, or a rider can sign, between the tick and the click.
    if (selectedIds.length === 0) return;
    const result = await remind.mutateAsync({ ids: selectedIds, message });
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

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!remind.isPending) onOpenChange(next);
      }}
    >
      <DialogContent
        className="flex max-h-[min(92vh,760px)] w-[min(720px,96vw)] flex-col gap-0 overflow-visible rounded-xl p-0"
        showCloseButton={!remind.isPending}
        closeOutside
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <BellRing className="h-3.5 w-3.5" />
              {t("remindSubtitle")}
            </p>
            {selectable.length > 0 ? (
              <button
                type="button"
                onClick={toggleAll}
                className="cursor-pointer text-[11px] font-semibold text-primary hover:underline"
              >
                {t("selectAll")}
              </button>
            ) : null}
          </div>

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
                      <p className="truncate text-xs font-medium">
                        {row.label ?? row.request_code}
                        <span className="ms-1.5 font-mono text-[10px] text-muted-foreground">
                          {row.request_code}
                        </span>
                      </p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {panelStageLabel(stage, t)}
                        {info && info.reminderCount > 0
                          ? ` · ${t("cooldownHint", {
                              count: info.reminderCount,
                              hours: state?.cooldownHours ?? 0,
                            })}`
                          : ""}
                      </p>
                    </div>
                    {info && info.reminderCount > 0 ? (
                      <span
                        className={
                          blocked
                            ? "shrink-0 rounded-md border border-amber-200 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                            : "shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"
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
          <Textarea
            className="mt-3 min-h-16 text-sm"
            placeholder={t("remindMessage")}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-800">
              {t("channelApp")}
            </span>
            <span className="rounded-md border border-amber-200 bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-800">
              {t("channelSms")} · Coming soon
            </span>
            <span className="rounded-md border border-amber-200 bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-800">
              {t("channelEmail")} · Coming soon
            </span>
          </div>
        </div>

        <AppModalFooter title={t("remindTitle")} subtitle={t("remindSubtitle")}>
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
            className="h-9 cursor-pointer rounded-md px-4"
            onClick={() => void submit()}
            disabled={remind.isPending || selectedIds.length === 0}
          >
            {remind.isPending ? (
              <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <MailCheck className="me-1.5 h-3.5 w-3.5" />
            )}
            {t("remindSelected", { count: selectedIds.length })}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The recipient stage as one short line, reusing the tracker's own labels. */
function panelStageLabel(
  stage: ReturnType<typeof esignRecipientStage>,
  t: ReturnType<typeof useTranslations>,
): string {
  if (stage === "opened") return t("stageOpened");
  if (stage === "not_opened") return t("stageNotOpened");
  if (stage === "signed") return t("stageSigned");
  if (stage === "declined") return t("stageDeclined");
  if (stage === "expired") return t("stageExpired");
  return t("stageCancelled");
}
