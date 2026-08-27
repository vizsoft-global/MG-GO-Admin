"use client";

import { Download, PanelRightOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fetchRequestAttachmentUrl } from "./requests-actions";
import { RequestApprovalTimeline } from "./request-approval-timeline";
import { getExtraPayloadRows, getTypedFieldRows } from "./request-typed-fields";
import { requestStatusLabelKey, requestStatusVariant } from "./request-status-utils";
import { RequesterHeader } from "./requester-header";
import type { RequestApprovalStep, RequestAttachment, RequestDetail } from "./types";

function formatFileSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RequestTypedDrawer({
  request,
  steps,
  attachments,
}: {
  request: RequestDetail;
  steps: RequestApprovalStep[];
  attachments: RequestAttachment[];
}) {
  const t = useTranslations("pages.requests");
  const rows = getTypedFieldRows(request);
  const subjectRow = rows.find((row) => row.key === "subject" && row.value !== "—");
  const detailRows = [
    ...rows.filter((row) => row.key !== "subject" && row.key !== "description"),
    ...getExtraPayloadRows(request),
  ];
  const descriptionRow = rows.find((row) => row.key === "description");
  const message =
    descriptionRow && descriptionRow.value !== "—" ? descriptionRow.value : request.details;

  const openAttachment = async (storageKey: string) => {
    const result = await fetchRequestAttachmentUrl(storageKey);
    if (!result.url) {
      toast.error(result.error ?? t("detail.actionFailed"));
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm" className="h-9" />
        }
      >
        <PanelRightOpen className="me-1.5 h-3.5 w-3.5" />
        {t("detail.viewDrawer")}
      </DialogTrigger>
      <DialogContent
        closeOutside
        className="right-3 left-auto top-3 max-w-none translate-x-0 translate-y-0 overflow-visible"
        // Inline: Tailwind does not emit these nested calc() arbitrary values, and twMerge
        // already strips the base w-full/max-w-lg, which left the drawer unsized.
        style={{ width: "min(440px, calc(100vw - 24px))", maxHeight: "calc(100dvh - 24px)" }}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="font-semibold tabular-nums">
                {request.request_code}
              </span>
              <StatusPill variant="neutral">
                {t(`types.${request.request_type}` as "types.leave")}
              </StatusPill>
              <StatusPill dot variant={requestStatusVariant(request.status, request.payload)}>
                {t(`status.${requestStatusLabelKey(request.status, request.payload)}` as "status.pending")}
              </StatusPill>
            </div>

            <div className="border-t border-border pt-2.5">
              <RequesterHeader
                driverId={request.driver_id}
                requestId={request.id}
                requester={request.requester}
              />
            </div>

            {subjectRow || message ? (
              <div className="space-y-1.5 border-t border-border pt-2.5">
                {subjectRow ? (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("detail.subject")}
                    </p>
                    <p className="text-sm font-semibold">{subjectRow.value}</p>
                  </div>
                ) : null}
                {message ? (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("detail.message")}
                    </p>
                    <p className="text-sm text-foreground/90 whitespace-pre-wrap">{message}</p>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-1.5 border-t border-border pt-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("detail.attachments")}
              </p>
              {attachments.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">{t("detail.noAttachments")}</p>
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  {attachments.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => void openAttachment(a.storage_key)}
                      className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/20 px-2 py-1.5 text-start transition-colors hover:border-primary/40 hover:bg-primary/10"
                    >
                      <Download className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-medium">
                          {a.file_name ?? a.storage_key.split("/").pop()}
                        </p>
                        {a.byte_size != null ? (
                          <p className="text-[10px] text-muted-foreground">
                            {formatFileSize(a.byte_size)}
                          </p>
                        ) : null}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {detailRows.length > 0 ? (
              <div className="border-t border-border pt-2.5">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("detail.fields")}
                </p>
                <div className="divide-y divide-border rounded-lg border border-border">
                  {detailRows.map((row) => (
                    <div
                      key={row.key}
                      className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-sm"
                    >
                      <span className="text-xs text-muted-foreground">{row.label}</span>
                      {row.gatedKey ? (
                        <span className="text-[11px] text-warning">
                          {t(`detail.${row.gatedKey}` as "detail.categoryGated")}
                        </span>
                      ) : (
                        <span
                          className={cn(
                            "max-w-[60%] break-words text-end font-medium",
                            row.value === "—" && "text-muted-foreground",
                          )}
                        >
                          {row.value}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {steps.length > 0 ? (
              <div className="border-t border-border pt-2.5">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("detail.approval")}
                </p>
                <RequestApprovalTimeline steps={steps} />
              </div>
            ) : null}
          </div>
          <AppModalFooter
            title={t(`types.${request.request_type}` as "types.leave")}
            subtitle={request.request_code}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
