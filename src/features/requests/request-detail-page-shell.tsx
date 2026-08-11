"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Download, Loader2, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { AppPage, AppPageHeader } from "@/components/app";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/auth-context";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { fetchRequestAttachmentUrl } from "./requests-actions";
import { RequestApprovalTimeline } from "./request-approval-timeline";
import { RequestTypedDrawer } from "./request-typed-drawer";
import { getTypedFieldRows } from "./request-typed-fields";
import { requestStatusLabelKey, requestStatusVariant } from "./request-status-utils";
import { RequesterHeader } from "./requester-header";
import type { RequestApprovalStep } from "./types";
import { useAdminRequestDetail, useDecideRequest } from "./use-requests";

function formatFileSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function currentStepAllowedActions(steps: RequestApprovalStep[]): string[] {
  const active = steps.find((s) => s.status === "in_progress");
  return active?.allowed_actions ?? [];
}

export function RequestDetailPageShell({ requestId }: { requestId: string }) {
  const t = useTranslations("pages.requests");
  const { can } = useAuth();
  const canDecide = can("requests.approve") || can("requests.manage");
  const { data, isLoading, refetch } = useAdminRequestDetail(requestId);
  const decide = useDecideRequest(requestId);
  const [reason, setReason] = useState("");

  const request = data?.request;
  const steps = data?.steps ?? [];
  const clarifications = data?.clarifications ?? [];
  const attachments = data?.attachments ?? [];
  const rows = request ? getTypedFieldRows(request) : [];
  const subjectRow = rows.find((row) => row.key === "subject" && row.value !== "—");
  const detailRows = rows.filter((row) => row.key !== "subject" && row.key !== "description");
  const descriptionRow = rows.find((row) => row.key === "description");
  const message =
    descriptionRow && descriptionRow.value !== "—" ? descriptionRow.value : request?.details;
  const closed =
    request?.status === "approved" ||
    request?.status === "rejected" ||
    request?.status === "solved";
  const stepActions = currentStepAllowedActions(steps);
  const REASON_REQUIRED_ACTIONS = new Set(["reject", "clarify"]);

  const runAction = async (action: string) => {
    if (REASON_REQUIRED_ACTIONS.has(action) && !reason.trim()) {
      toast.error(t("detail.reasonRequired"));
      return;
    }
    const result = await decide.mutateAsync({
      action,
      reason: reason.trim() || undefined,
    });
    if (!result.ok) {
      toast.error(result.error ?? t("detail.actionFailed"));
      return;
    }
    toast.success(t("detail.actionOk"));
    setReason("");
    await refetch();
  };

  const openAttachment = async (storageKey: string) => {
    const result = await fetchRequestAttachmentUrl(storageKey);
    if (!result.url) {
      toast.error(result.error ?? t("detail.actionFailed"));
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  };

  if (isLoading) {
    return (
      <AppPage>
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppPage>
    );
  }

  if (!request) {
    return (
      <AppPage>
        <AppPageHeader title={t("detail.notFound")} />
        <Button variant="outline" className="h-9" render={<Link href="/requests/overview" />}>
          <ArrowLeft className="me-1.5 h-3.5 w-3.5" />
          {t("detail.back")}
        </Button>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <AppPageHeader
        title={request.request_code}
        description={`${t(`types.${request.request_type}` as "types.leave")} · ${request.current_step_label ?? "—"}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill variant={requestStatusVariant(request.status, request.payload)}>
              {t(`status.${requestStatusLabelKey(request.status, request.payload)}` as "status.pending")}
            </StatusPill>
            <RequestTypedDrawer request={request} steps={steps} attachments={attachments} />
            <Button variant="outline" size="sm" className="h-9" render={<Link href="/requests/overview" />}>
              <ArrowLeft className="me-1.5 h-3.5 w-3.5" />
              {t("detail.back")}
            </Button>
          </div>
        }
      />

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <RequesterHeader driverId={request.driver_id} requester={request.requester} />
      </div>

      <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
        <section className="h-full rounded-xl border border-border bg-card p-4 shadow-sm">
          {subjectRow || request.details ? (
            <div className="mb-3 space-y-1.5">
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
                  <p className="text-sm whitespace-pre-wrap text-foreground/90">{message}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          <h2 className="mb-2 text-sm font-semibold">{t("detail.fields")}</h2>
          {detailRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("detail.noTypedFields")}</p>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border text-sm">
              {detailRows.map((row) => (
                <div
                  key={row.key}
                  className="flex items-center justify-between gap-2 px-2.5 py-1.5"
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
          )}

          <div className="mt-3 border-t border-border pt-3">
            <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Paperclip className="h-3.5 w-3.5" />
              {t("detail.attachments")}
            </h3>
            {attachments.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">{t("detail.noAttachments")}</p>
            ) : (
              <ul className="space-y-1">
                {attachments.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => void openAttachment(a.storage_key)}
                      className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {a.file_name ?? a.storage_key.split("/").pop()}
                      {a.byte_size != null ? (
                        <span className="text-[11px] text-muted-foreground">
                          {formatFileSize(a.byte_size)}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="h-full rounded-xl border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold">{t("detail.approval")}</h2>
          <RequestApprovalTimeline steps={steps} />

          {clarifications.length > 0 ? (
            <div className="mt-3 space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground">
                {t("detail.clarifications")}
              </h3>
              {clarifications.map((c) => (
                <div key={c.id} className="rounded-lg border border-border p-2 text-xs">
                  <p className="font-medium">{c.question}</p>
                  {c.answer ? (
                    <p className="mt-1 text-muted-foreground">{c.answer}</p>
                  ) : (
                    <p className="mt-1 text-warning">{t("detail.awaitingAnswer")}</p>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </div>

      {canDecide && !closed ? (
        <section className="mt-2 rounded-xl border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold">{t("detail.actions")}</h2>
          <Textarea
            className="min-h-20 text-sm"
            placeholder={t("detail.reasonPlaceholder")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {stepActions.length > 0 ? (
              stepActions.map((action) =>
                action === "reject" ? null : (
                  <Button
                    key={action}
                    type="button"
                    className="h-9"
                    disabled={decide.isPending}
                    onClick={() => void runAction(action)}
                  >
                    {t(`detail.actionLabels.${action}` as "detail.actionLabels.approve")}
                  </Button>
                ),
              )
            ) : (
              <Button
                type="button"
                className="h-9"
                disabled={decide.isPending}
                onClick={() => void runAction("solve")}
              >
                {t("detail.solve")}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className="h-9 text-destructive hover:bg-destructive/10"
              disabled={decide.isPending}
              onClick={() => void runAction("reject")}
            >
              {t("detail.reject")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9"
              disabled={decide.isPending}
              onClick={() => void runAction("clarify")}
            >
              {t("detail.clarify")}
            </Button>
          </div>
        </section>
      ) : null}
    </AppPage>
  );
}
