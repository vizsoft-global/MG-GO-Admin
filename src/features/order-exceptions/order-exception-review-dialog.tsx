"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  BadgeCheck,
  Calendar,
  Check,
  ExternalLink,
  ImageOff,
  Loader2,
  MessageSquare,
  Receipt,
  Store,
  Truck,
  User,
  X,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { cn } from "@/lib/utils";
import type {
  OrderExceptionProof,
  OrderExceptionRow,
  ReviewOrderExceptionInput,
} from "./types";

export type ReviewDialogProps = {
  row: OrderExceptionRow | null;
  open: boolean;
  proofs: OrderExceptionProof[];
  proofsLoading: boolean;
  submitting: boolean;
  actionError: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: ReviewOrderExceptionInput) => void;
};

const STATUS_TONE: Record<OrderExceptionRow["status"], string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-rose-200 bg-rose-50 text-rose-700",
};

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
        {children}
      </div>
    </div>
  );
}

export function OrderExceptionReviewDialog(props: ReviewDialogProps) {
  return (
    <OrderExceptionReviewForm
      {...props}
      key={props.open ? (props.row?.id ?? "open") : "closed"}
    />
  );
}

function OrderExceptionReviewForm({
  row,
  open,
  proofs,
  proofsLoading,
  submitting,
  actionError,
  onOpenChange,
  onConfirm,
}: ReviewDialogProps) {
  const t = useTranslations("pages.orderExceptions");
  const [note, setNote] = useState("");
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(null);
  const [showNoteError, setShowNoteError] = useState(false);
  const [preview, setPreview] = useState<OrderExceptionProof | null>(null);

  const noteMissing = showNoteError && !note.trim();

  const statusLabel = useMemo(() => {
    if (!row) return "";
    if (row.status === "pending") return t("statusPending");
    if (row.status === "approved") return t("statusApproved");
    return t("statusRejected");
  }, [row, t]);

  const kindLabel = row ? (row.kind === "rejected" ? t("kindRejected") : t("kindCancelled")) : "";
  const sourceLabel = row
    ? row.source === "driver_declined"
      ? t("sourceDriver")
      : t("sourceStore")
    : "";
  const reviewedDay = row?.reviewed_at ? row.reviewed_at.slice(0, 10) : "";

  function submit(next: "approved" | "rejected") {
    if (submitting || !row) return;
    if (next === "rejected" && !note.trim()) {
      setShowNoteError(true);
      return;
    }
    setDecision(next);
    onConfirm({
      id: row.id,
      decision: next,
      note: note.trim() || undefined,
    });
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (submitting) return;
          onOpenChange(next);
        }}
      >
        <DialogContent
          showCloseButton
          closeOutside
          className="w-[min(820px,96vw)] gap-0 p-0"
        >
          {row ? (
            <div className="space-y-3 px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("reviewTitle")}
                  </p>
                  <p className="mt-0.5 truncate text-base font-semibold text-foreground">
                    {row.driver_name || row.driver_code || row.driver_id}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {t("riderSnapshot", {
                      code: row.driver_code || "—",
                      name: row.driver_name || "—",
                    })}
                  </p>
                </div>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
                    STATUS_TONE[row.status],
                  )}
                >
                  {row.status === "pending" ? (
                    <AlertTriangle className="h-3 w-3" />
                  ) : row.status === "approved" ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <X className="h-3 w-3" />
                  )}
                  {statusLabel}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-muted/20 p-3 sm:grid-cols-4">
                <Field label={t("colOrder")}>
                  <Receipt className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono text-xs">{row.order_id || "—"}</span>
                </Field>
                <Field label={t("colKind")}>
                  <AlertTriangle className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{kindLabel}</span>
                </Field>
                <Field label={t("colSource")}>
                  {row.source === "driver_declined" ? (
                    <Truck className="h-3 w-3 shrink-0 text-muted-foreground" />
                  ) : (
                    <Store className="h-3 w-3 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{sourceLabel}</span>
                </Field>
                <Field label={t("colDay")}>
                  <Calendar className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{row.day || "—"}</span>
                </Field>
              </div>

              <div className="rounded-xl border border-border p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <MessageSquare className="h-3 w-3" />
                  {t("colReason")}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
                  {row.reason || "—"}
                </p>
              </div>

              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("colProof")}
                  <span className="rounded-full bg-muted px-1.5 py-px text-xs font-medium normal-case text-muted-foreground">
                    {t("proofCount", { count: proofs.length })}
                  </span>
                </p>
                {proofsLoading ? (
                  <div className="flex gap-2" aria-busy="true">
                    {[0, 1, 2].map((key) => (
                      <div
                        key={key}
                        className="h-16 w-24 animate-pulse rounded-lg border border-border bg-muted/60"
                      />
                    ))}
                  </div>
                ) : proofs.length ? (
                  <div className="flex flex-wrap gap-2">
                    {proofs.map((proof, index) => (
                      <button
                        key={`${proof.url}-${index}`}
                        type="button"
                        onClick={() => setPreview(proof)}
                        className="group relative h-16 w-24 cursor-pointer overflow-hidden rounded-lg border border-border bg-muted transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`${t("colProof")} ${index + 1}`}
                        title={t("viewDetails")}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={proof.url}
                          alt={`${t("colProof")} ${index + 1}`}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                        <span className="absolute inset-0 flex items-center justify-center text-transparent transition-colors group-hover:bg-foreground/40 group-hover:text-background">
                          <ExternalLink className="h-4 w-4" />
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    <ImageOff className="h-3.5 w-3.5" />
                    {t("proofNone")}
                  </p>
                )}
              </div>

              {row.status !== "pending" ? (
                <div
                  className={cn(
                    "rounded-xl border p-3",
                    row.status === "approved"
                      ? "border-emerald-200 bg-emerald-50/60"
                      : "border-rose-200 bg-rose-50/60",
                  )}
                >
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {row.status === "approved" ? (
                      <BadgeCheck className="h-3 w-3" />
                    ) : (
                      <AlertTriangle className="h-3 w-3" />
                    )}
                    {statusLabel}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground">
                    <span className="inline-flex items-center gap-1">
                      <User className="h-3 w-3 text-muted-foreground" />
                      {row.reviewed_by_name || "—"}
                    </span>
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {reviewedDay || "—"}
                    </span>
                  </div>
                  {row.review_note ? (
                    <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
                      {t("reviewNote")}: {row.review_note}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {row.status === "pending" ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="order-exception-review-note"
                      className="text-xs font-semibold text-foreground"
                    >
                      {t("reviewNote")}
                    </label>
                    {noteMissing ? (
                      <span className="text-xs font-medium text-destructive">
                        {t("reviewNoteRequired")}
                      </span>
                    ) : null}
                  </div>
                  <Textarea
                    id="order-exception-review-note"
                    value={note}
                    onChange={(event) => {
                      setNote(event.target.value);
                      if (event.target.value.trim()) setShowNoteError(false);
                    }}
                    placeholder={t("reviewNotePlaceholder")}
                    rows={3}
                    disabled={submitting}
                    aria-invalid={noteMissing || undefined}
                    className={cn(
                      "min-h-[68px] resize-none text-xs",
                      noteMissing && "border-destructive focus-visible:ring-destructive",
                    )}
                  />
                  <div className="flex flex-col gap-1 text-xs leading-snug text-muted-foreground sm:flex-row sm:gap-4">
                    <span className="inline-flex items-center gap-1">
                      <Check className="h-3 w-3 text-emerald-600" />
                      {t("approveHint")}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-rose-600" />
                      {t("rejectHint")}
                    </span>
                  </div>
                  {actionError ? (
                    <p role="alert" className="text-xs font-medium text-destructive">
                      {actionError}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <AppModalFooter
            title={row ? t("reviewTitle") : t("title")}
            subtitle={
              row
                ? t("riderSnapshot", {
                    code: row.driver_code || "—",
                    name: row.order_id || "—",
                  })
                : undefined
            }
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            {row?.status === "pending" ? (
              <>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="h-9"
                  disabled={submitting}
                  onClick={() => submit("rejected")}
                >
                  {submitting && decision === "rejected" ? (
                    <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="me-1.5 h-3.5 w-3.5" />
                  )}
                  {submitting && decision === "rejected" ? t("saving") : t("reviewReject")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-9"
                  disabled={submitting}
                  onClick={() => submit("approved")}
                >
                  {submitting && decision === "approved" ? (
                    <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="me-1.5 h-3.5 w-3.5" />
                  )}
                  {submitting && decision === "approved" ? t("saving") : t("reviewApprove")}
                </Button>
              </>
            ) : null}
          </AppModalFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(preview)}
        onOpenChange={(next) => {
          if (!next) setPreview(null);
        }}
      >
        <DialogContent
          showCloseButton
          closeOutside
          className="w-[min(1100px,96vw)] gap-0 p-0"
        >
          <div className="flex max-h-[calc(100dvh-10rem)] items-center justify-center bg-muted/40 p-3">
            {preview ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={preview.url}
                alt={t("colProof")}
                className="max-h-[calc(100dvh-13rem)] w-auto max-w-full rounded-lg object-contain"
              />
            ) : null}
          </div>
          <AppModalFooter title={t("colProof")}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => setPreview(null)}
            >
              {t("cancel")}
            </Button>
            {preview ? (
              <Button
                size="sm"
                className="h-9"
                render={
                  <a href={preview.url} target="_blank" rel="noreferrer">
                    <ExternalLink className="me-1.5 h-3.5 w-3.5" />
                    {t("viewDetails")}
                  </a>
                }
              />
            ) : null}
          </AppModalFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
