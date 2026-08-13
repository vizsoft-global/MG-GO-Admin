"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { SegmentOption } from "@/components/app/toggle-chip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  createRequestType,
  updateRequestType,
} from "./request-type-builder-actions";
import {
  REQUEST_TYPE_ERROR_CODES,
  type RequestTerminalStatus,
  type RequestTypeDefinitionRow,
  type RequestTypeInput,
} from "./settings-types";

const EMPTY: RequestTypeInput = {
  key: "",
  label_en: "",
  label_ar: null,
  icon_key: null,
  is_active: true,
  sort_order: 0,
  screenshot_restricted: false,
  terminal_status_on_approve: "approved",
  requires_driver_ack_on_approve: false,
  date_range_required: false,
  min_attachments: 0,
};

function keyFromLabel(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function RequestTypeFormDialog({
  open,
  onOpenChange,
  existing,
  nextSortOrder,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent = create. Present = edit; the key becomes read-only. */
  existing?: RequestTypeDefinitionRow;
  nextSortOrder: number;
  onSaved: () => void;
}) {
  const t = useTranslations("pages.requests.settings.types");
  const [draft, setDraft] = useState<RequestTypeInput>(EMPTY);
  const [keyTouched, setKeyTouched] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setKeyTouched(Boolean(existing));
    setDraft(
      existing
        ? {
            key: existing.key,
            label_en: existing.label_en,
            label_ar: existing.label_ar,
            icon_key: existing.icon_key,
            is_active: existing.is_active,
            sort_order: existing.sort_order,
            screenshot_restricted: existing.screenshot_restricted,
            terminal_status_on_approve: existing.terminal_status_on_approve,
            requires_driver_ack_on_approve: existing.requires_driver_ack_on_approve,
            date_range_required: existing.date_range_required,
            min_attachments: existing.min_attachments,
          }
        : { ...EMPTY, sort_order: nextSortOrder },
    );
  }, [open, existing, nextSortOrder]);

  function patch(next: Partial<RequestTypeInput>) {
    setDraft((prev) => ({ ...prev, ...next }));
  }

  // Acknowledgement is only written when a request lands on `approved`; a type that
  // resolves has nothing for the rider to acknowledge.
  const ackDisabled = draft.terminal_status_on_approve !== "approved";

  function submit() {
    startTransition(async () => {
      const result = existing
        ? await updateRequestType(existing.key, {
            label_en: draft.label_en,
            label_ar: draft.label_ar,
            icon_key: draft.icon_key,
            is_active: draft.is_active,
            sort_order: draft.sort_order,
            screenshot_restricted: draft.screenshot_restricted,
            terminal_status_on_approve: draft.terminal_status_on_approve,
            requires_driver_ack_on_approve:
              !ackDisabled && draft.requires_driver_ack_on_approve,
            date_range_required: draft.date_range_required,
            min_attachments: draft.min_attachments,
          })
        : await createRequestType({
            ...draft,
            requires_driver_ack_on_approve:
              !ackDisabled && draft.requires_driver_ack_on_approve,
          });

      if (!result.ok) {
        toast.error(
          result.error && REQUEST_TYPE_ERROR_CODES.has(result.error)
            ? t(`errors.${result.error}` as "errors.saveFailed")
            : (result.error ?? t("errors.saveFailed")),
        );
        return;
      }
      toast.success(existing ? t("updated") : t("created"));
      onOpenChange(false);
      onSaved();
    });
  }

  const canSubmit =
    draft.label_en.trim().length > 0 && /^[a-z][a-z0-9_]*$/.test(draft.key);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(760px,96vw)] max-w-[min(760px,96vw)] overflow-visible pt-4"
        showCloseButton
        closeOutside
      >
        <div className="space-y-3 px-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">
                {t("fieldLabelEn")} <span className="text-destructive">*</span>
              </Label>
              <Input
                className="h-9"
                value={draft.label_en}
                onChange={(e) => {
                  const label_en = e.target.value;
                  patch(
                    keyTouched
                      ? { label_en }
                      : { label_en, key: keyFromLabel(label_en) },
                  );
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("fieldSortOrder")}</Label>
              <Input
                className="h-9"
                type="number"
                value={draft.sort_order}
                onChange={(e) => patch({ sort_order: Number(e.target.value) || 0 })}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">
                {t("fieldKey")} <span className="text-destructive">*</span>
              </Label>
              <Input
                className="h-9 font-mono text-xs"
                value={draft.key}
                disabled={Boolean(existing)}
                onChange={(e) => {
                  setKeyTouched(true);
                  patch({ key: e.target.value.trim() });
                }}
              />
              <p className="text-[10px] text-muted-foreground">
                {existing ? t("keyLocked") : t("keyHint")}
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("fieldLabelAr")}</Label>
              <Input
                className="h-9"
                dir="rtl"
                value={draft.label_ar ?? ""}
                onChange={(e) => patch({ label_ar: e.target.value || null })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("fieldIcon")}</Label>
              <Input
                className="h-9 font-mono text-xs"
                placeholder="event_available_outlined"
                value={draft.icon_key ?? ""}
                onChange={(e) => patch({ icon_key: e.target.value || null })}
              />
              <p className="text-[10px] text-muted-foreground">{t("iconHint")}</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">{t("fieldTerminalStatus")}</Label>
              <div role="radiogroup" className="grid grid-cols-2 gap-1.5">
                <SegmentOption
                  selected={draft.terminal_status_on_approve === "approved"}
                  onClick={() =>
                    patch({ terminal_status_on_approve: "approved" as RequestTerminalStatus })
                  }
                  variant="success"
                >
                  {t("terminalApproved")}
                </SegmentOption>
                <SegmentOption
                  selected={draft.terminal_status_on_approve === "solved"}
                  onClick={() =>
                    patch({ terminal_status_on_approve: "solved" as RequestTerminalStatus })
                  }
                >
                  {t("terminalSolved")}
                </SegmentOption>
              </div>
              <p className="text-[10px] text-muted-foreground">{t("terminalHint")}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("fieldMinAttachments")}</Label>
              <Input
                className="h-9"
                type="number"
                min={0}
                value={draft.min_attachments}
                onChange={(e) =>
                  patch({ min_attachments: Math.max(0, Number(e.target.value) || 0) })
                }
              />
              <p className="text-[10px] text-muted-foreground">{t("minAttachmentsHint")}</p>
            </div>
          </div>

          <div className="grid gap-2 rounded-xl border border-border bg-muted/20 p-3 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-3 text-xs">
              <span>{t("toggleActive")}</span>
              <Switch
                checked={draft.is_active}
                onCheckedChange={(v) => patch({ is_active: v })}
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-xs">
              <span>{t("toggleScreenshot")}</span>
              <Switch
                checked={draft.screenshot_restricted}
                onCheckedChange={(v) => patch({ screenshot_restricted: v })}
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-xs">
              <span>{t("toggleDateRange")}</span>
              <Switch
                checked={draft.date_range_required}
                onCheckedChange={(v) => patch({ date_range_required: v })}
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-xs">
              <span className={ackDisabled ? "text-muted-foreground" : undefined}>
                {t("toggleAck")}
                {ackDisabled ? (
                  <span className="ms-1 text-[10px]">({t("ackNotApplicable")})</span>
                ) : null}
              </span>
              <Switch
                checked={!ackDisabled && draft.requires_driver_ack_on_approve}
                disabled={ackDisabled}
                onCheckedChange={(v) => patch({ requires_driver_ack_on_approve: v })}
              />
            </label>
          </div>
        </div>

        <AppModalFooter
          title={existing ? t("editTitle") : t("addRequestType")}
          subtitle={existing ? t("editSubtitle") : t("addSubtitle")}
        >
          <Button variant="outline" size="sm" className="h-9" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button size="sm" className="h-9" disabled={!canSubmit || isPending} onClick={submit}>
            {isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {existing ? t("save") : t("create")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
