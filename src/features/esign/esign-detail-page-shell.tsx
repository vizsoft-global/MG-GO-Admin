"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  Check,
  Download,
  FileText,
  Loader2,
  Paperclip,
  Printer,
  RefreshCw,
  Shield,
  ShieldOff,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import {
  addEsignAttachment,
  decideEsignRequest,
  removeEsignAttachment,
  uploadEsignAttachmentFile,
  type EsignReviewDecision,
} from "./esign-actions";
import { esignDocumentHref } from "./esign-storage-key";
import { EsignSignersEditor } from "./esign-signers-editor";
import { formatStampInstant } from "./esign-stamp-layout";
import { regenerateEsignSheet } from "./esign-stamp-actions";
import { EsignStampPlacer, type EsignStampPlacerHandle } from "./esign-stamp-placer";
import { useEsignDocumentLinks, useEsignRequestDetail } from "./use-esign";
import { useAuth } from "@/contexts/auth-context";
import type { EsignRequestStatus } from "./types";

function statusVariant(
  status: EsignRequestStatus,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "signed") return "success";
  if (status === "declined") return "danger";
  if (status === "expired" || status === "cancelled") return "neutral";
  if (status === "pending") return "warning";
  return "neutral";
}

function formatStamp(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "—";
  return size >= 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
}

/** Signature proof keys the driver app writes into `esign_requests.signer_meta`. */
const PROOF_KEYS = [
  "employee_id",
  "phone",
  "civil_id",
  "company",
  "ip_address",
  "device",
] as const;

function TimelineStep({
  label,
  at,
  pendingLabel,
  tone = "success",
}: {
  label: string;
  at: string | null;
  pendingLabel?: string;
  tone?: "success" | "danger";
}) {
  const done = Boolean(at);
  return (
    <li className="flex items-start gap-2">
      <span
        className={cn(
          "mt-1 h-2 w-2 shrink-0 rounded-full",
          !done
            ? "bg-muted-foreground/30"
            : tone === "danger"
              ? "bg-destructive"
              : "bg-emerald-500",
        )}
      />
      <div>
        <p className={cn("text-xs font-medium", !done && "text-muted-foreground")}>{label}</p>
        <p className="text-[10px] text-muted-foreground">
          {at ? formatStamp(at) : (pendingLabel ?? "—")}
        </p>
      </div>
    </li>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-end text-xs font-medium">{value}</dd>
    </div>
  );
}

export function EsignDetailPageShell({ requestId }: { requestId: string }) {
  const t = useTranslations("pages.requests.esign.detail");
  const tCommon = useTranslations("pages.requests.esign");
  const auth = useAuth();
  const queryClient = useQueryClient();
  const placerRef = useRef<EsignStampPlacerHandle>(null);
  const { data, isLoading, refetch } = useEsignRequestDetail(requestId);
  const {
    data: links,
    isLoading: linksLoading,
    refetch: refetchLinks,
  } = useEsignDocumentLinks(requestId);
  const request = data?.request;
  const [busy, setBusy] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  async function addAttachments(files: FileList | null) {
    if (!files || files.length === 0 || !request) return;
    setBusy(true);
    try {
      const remaining = Math.max(0, 5 - (request.attachments?.length ?? 0));
      if (remaining === 0) {
        toast.error(t("attachmentLimit"));
        return;
      }
      for (const file of Array.from(files).slice(0, remaining)) {
        const form = new FormData();
        form.append("file", file);
        const uploaded = await uploadEsignAttachmentFile(form);
        if (!uploaded.ok || !uploaded.key) {
          toast.error(t("attachmentUploadFailed"));
          continue;
        }
        const added = await addEsignAttachment({
          requestId,
          storageKey: uploaded.key,
          name: uploaded.name ?? file.name,
          contentType: uploaded.contentType ?? file.type,
          size: uploaded.size ?? file.size,
        });
        if (!added.ok) toast.error(t("attachmentUploadFailed"));
      }
      await refetch();
      toast.success(t("attachmentsSaved"));
    } finally {
      setBusy(false);
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
    }
  }

  async function removeAttachment(attachmentId: string) {
    setBusy(true);
    const result = await removeEsignAttachment(attachmentId);
    setBusy(false);
    if (!result.ok) {
      toast.error(t("reviewFailed"));
      return;
    }
    await refetch();
    toast.success(t("attachmentRemoved"));
  }

  async function regenerate() {
    setRegenerating(true);
    try {
      const result = await regenerateEsignSheet(requestId);
      if (!result.ok) {
        toast.error(
          result.error === "signed_locked"
            ? t("regenerateSigned")
            : t("regenerateFailed"),
        );
        return;
      }
      await Promise.all([refetch(), refetchLinks()]);
      toast.success(t("regenerated"));
    } finally {
      setRegenerating(false);
    }
  }

  async function decide(decision: EsignReviewDecision) {
    setBusy(true);
    const result = await decideEsignRequest({
      requestId,
      decision,
      note: decision === "reject" ? rejectReason.trim() : null,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(t("reviewFailed"));
      return;
    }
    setRejectOpen(false);
    setRejectReason("");
    await refetch();
    toast.success(
      decision === "reject"
        ? t("reviewRejected")
        : decision === "acknowledge"
          ? t("reviewAcknowledged")
          : t("reviewApproved"),
    );
  }

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
        <AppPageHeader title={t("notFound")} />
        <Button variant="outline" className="h-9" render={<Link href="/employeedesk/esign/batches?scope=individual" />}>
          <ArrowLeft className="me-1.5 h-3.5 w-3.5" />
          {t("back")}
        </Button>
      </AppPage>
    );
  }

  const meta = request.signer_meta ?? {};
  const proofRows = PROOF_KEYS.map((key) => ({
    key,
    value: meta[key] != null && String(meta[key]).trim() !== "" ? String(meta[key]) : null,
  })).filter((row) => row.value != null);
  const declinedReason =
    meta.declined_reason != null && String(meta.declined_reason).trim() !== ""
      ? String(meta.declined_reason)
      : null;

  // A signed request is placed on the filled template stored with the request.
  // Print and download wait for that placement to be written into the signed PDF.
  const previewUrl = links?.signedDocumentUrl ?? links?.documentUrl ?? null;
  const previewIsSignedCopy = Boolean(links?.signedDocumentUrl);
  const canPlace =
    request.status === "signed" && Boolean(links?.documentUrl && links?.signatureUrl);
  const canManageRequests =
    auth.isSuperAdmin ||
    auth.isManager ||
    auth.can("requests.manage") ||
    auth.can("employeedesk.manage");
  const canEditUnsigned =
    canManageRequests &&
    ["pending", "draft", "sent", "viewed"].includes(request.status) &&
    Boolean(links?.documentUrl && request.template_id);
  const formLocked = !["pending", "draft", "sent", "viewed"].includes(request.status);
  const signersReadOnly = !["pending", "draft", "sent", "viewed"].includes(request.status);
  const documentRequestId = request.id;

  async function openSigned(disposition: "inline" | "attachment") {
    if (canPlace) {
      const saved = await placerRef.current?.flush();
      if (!saved) return;
    }
    const kind = links?.signedDocumentUrl || canPlace ? "signed" : "document";
    const href = `${esignDocumentHref(documentRequestId, kind, disposition)}&v=${Date.now()}`;
    if (kind !== "signed") {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    // The route composes the signed copy on demand. A 409 is not a failure: HR
    // still has a counter-signature to give, and the rider's copy cannot exist
    // before it does. Say that instead of opening a tab full of JSON.
    let response: Response;
    try {
      response = await fetch(href, { credentials: "same-origin", cache: "no-store" });
    } catch {
      toast.error(t("signedCopyFailed", { reason: "network" }));
      return;
    }
    if (response.status === 409) {
      toast.warning(t("awaitingCounterDownload"));
      void queryClient.invalidateQueries({
        queryKey: queryKeys.esign.detail(documentRequestId),
      });
      return;
    }
    if (!response.ok) {
      toast.error(t("signedCopyFailed", { reason: String(response.status) }));
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    if (disposition === "attachment") {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${data?.request?.request_code ?? documentRequestId}-signed.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <AppPage>
      <AppPageHeader
        title={request.title || request.request_code}
        description={request.request_code}
        breadcrumbs={[
          { label: tCommon("hub.title"), href: "/requests/esign" },
          { label: tCommon("signatures.title"), href: "/requests/esign/signatures" },
          { label: request.request_code },
        ]}
        actions={
          <div className="flex items-center gap-2">
            {canManageRequests && request.status !== "signed" && request.template_id ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                disabled={regenerating}
                onClick={() => void regenerate()}
                title={t("regenerateHint")}
              >
                {regenerating ? (
                  <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="me-1.5 h-3.5 w-3.5" />
                )}
                {t("regenerate")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={!canPlace && !links?.signedDocumentUrl && !links?.documentUrl}
              onClick={() => {
                void openSigned("inline");
              }}
            >
              <Printer className="me-1.5 h-3.5 w-3.5" />
              {t("print")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              render={<Link href="/employeedesk/esign/batches?scope=individual" />}
            >
              <ArrowLeft className="me-1.5 h-3.5 w-3.5" />
              {t("back")}
            </Button>
          </div>
        }
      />

      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-stretch">
        <AppListCard className="flex min-h-0 flex-col gap-3 bg-muted/30 p-2 lg:h-[calc(100dvh-8rem)]">
          {(canPlace && links?.documentUrl && links.signatureUrl) || canEditUnsigned ? (
            <EsignStampPlacer
              ref={placerRef}
              requestId={request.id}
              signatureUrl={links?.signatureUrl ?? ""}
              documentKind={request.document_kind}
              signatureSlots={request.signature_slots}
              stampLayout={request.stamp_layout}
              formOnly={!canPlace}
              formLocked={formLocked}
              labels={{
                name: request.signer_display_name?.trim() || "Signed by driver",
                date: formatStampInstant(request.signed_at),
                code: request.request_code,
                employeeId: request.employee_id ?? "",
                company: request.company_name ?? "",
                position: request.position ?? "",
                civilId: request.civil_id ?? "",
                zone: request.zone_name ?? "",
              }}
            />
          ) : previewUrl ? (
            <div className="flex min-h-0 flex-1 flex-col gap-1">
              <iframe
                src={previewUrl}
                title={request.title || request.request_code}
                className="min-h-0 w-full flex-1 rounded-lg border border-border bg-card"
              />
              {previewIsSignedCopy ? (
                <p className="text-[10px] text-muted-foreground">{t("previewSignedCopy")}</p>
              ) : null}
            </div>
          ) : linksLoading ? (
            // The signed URL is minted per view, so it lands a beat after the row. Claiming
            // "sent without a document" in that gap reads as a real defect to an admin.
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border bg-card py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card py-16 text-center">
              <FileText className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">{t("noDocumentTitle")}</p>
              <p className="max-w-xs text-[11px] text-muted-foreground">
                {t("noDocumentBody")}
              </p>
            </div>
          )}

          {links?.signatureUrl ? (
            <div className="rounded-lg border border-border bg-card p-3">
              <img
                src={links.signatureUrl}
                alt={request.signer_display_name ?? t("signerName")}
                className="h-16 object-contain"
              />
              <p className="mt-1 border-t border-border pt-1 text-[10px] text-muted-foreground">
                {t("signedElectronically", { at: formatStamp(request.signed_at) })}
              </p>
            </div>
          ) : null}
        </AppListCard>

        <div className="space-y-2">
          <AppListCard className="space-y-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t("statusSection")}</h3>
              <StatusPill variant={statusVariant(request.status)}>
                {tCommon(`status.${request.status}`)}
              </StatusPill>
            </div>
            {request.awaiting_counter_signature ? (
              <p className="text-[10px] font-medium text-amber-700">{t("awaitingCounter")}</p>
            ) : null}
            <ol className="space-y-2">
              <TimelineStep label={t("timelineSent")} at={request.sent_at} />
              <TimelineStep label={t("timelineViewed")} at={request.viewed_at} pendingLabel={t("timelinePending")} />
              {request.declined_at ? (
                <TimelineStep
                  label={t("timelineDeclined")}
                  at={request.declined_at}
                  tone="danger"
                />
              ) : (
                <TimelineStep
                  label={t("timelineSigned")}
                  at={request.signed_at}
                  pendingLabel={t("timelinePending")}
                />
              )}
            </ol>
          </AppListCard>

          <EsignSignersEditor requestId={request.id} readOnly={signersReadOnly} />

          <AppListCard className="space-y-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t("attachmentsSection")}</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={busy || (request.attachments?.length ?? 0) >= 5}
                onClick={() => attachmentInputRef.current?.click()}
              >
                {busy ? (
                  <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Paperclip className="me-1 h-3.5 w-3.5" />
                )}
                {t("addAttachment")}
              </Button>
              <input
                ref={attachmentInputRef}
                type="file"
                multiple
                accept="application/pdf,image/png,image/jpeg"
                className="hidden"
                onChange={(event) => void addAttachments(event.target.files)}
              />
            </div>
            {(request.attachments ?? []).length === 0 ? (
              <p className="text-[10px] text-muted-foreground">{t("noAttachments")}</p>
            ) : (
              <ul className="space-y-1.5">
                {(request.attachments ?? []).map((attachment) => (
                  <li
                    key={attachment.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5"
                  >
                    <a
                      href={attachment.downloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 truncate text-xs font-medium text-primary hover:underline"
                    >
                      {attachment.name}
                    </a>
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="text-[10px] text-muted-foreground">
                        {formatBytes(attachment.size)}
                      </span>
                      <button
                        type="button"
                        className="inline-flex size-7 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
                        aria-label={t("removeAttachment")}
                        disabled={busy}
                        onClick={() => void removeAttachment(attachment.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </AppListCard>

          {request.status === "signed" ? (
            <AppListCard className="space-y-2 p-4">
              <h3 className="text-sm font-semibold">{t("reviewSection")}</h3>
              {request.review_status ? (
                <div className="space-y-1 rounded-md border border-border bg-muted/30 p-2">
                  <p className="flex items-center gap-1.5 text-xs font-medium">
                    {request.review_status === "rejected" ? (
                      <X className="h-3.5 w-3.5 text-destructive" />
                    ) : (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    )}
                    {request.review_status === "rejected"
                      ? t("reviewRejected")
                      : request.review_status === "acknowledged"
                        ? t("reviewAcknowledged")
                        : t("reviewApproved")}
                  </p>
                  {request.review_note ? (
                    <p className="text-xs text-muted-foreground">{request.review_note}</p>
                  ) : null}
                  {request.reviewed_at ? (
                    <p className="text-[10px] text-muted-foreground">
                      {formatStamp(request.reviewed_at)}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    className="h-8"
                    disabled={busy}
                    onClick={() => void decide("approve")}
                  >
                    {t("approve")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={busy}
                    onClick={() => void decide("acknowledge")}
                  >
                    {t("acknowledge")}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="h-8"
                    disabled={busy}
                    onClick={() => setRejectOpen(true)}
                  >
                    {t("reject")}
                  </Button>
                </div>
              )}
            </AppListCard>
          ) : null}

          <AppListCard className="space-y-2 p-4">
            <h3 className="text-sm font-semibold">{t("detailsSection")}</h3>
            <dl className="space-y-1.5">
              <Row label={t("category")} value={request.category_label ?? "—"} />
              <Row
                label={t("recipient")}
                value={`${request.driver_name} · ${request.driver_code}`}
              />
              <Row label={t("created")} value={formatStamp(request.created_at)} />
              <Row label={t("due")} value={formatStamp(request.due_at)} />
              <Row label={t("viewedAt")} value={formatStamp(request.viewed_at)} />
              {request.declined_at ? (
                <Row label={t("declinedAt")} value={formatStamp(request.declined_at)} />
              ) : (
                <Row label={t("signedAt")} value={formatStamp(request.signed_at)} />
              )}
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[11px] text-muted-foreground">{t("screenshot")}</dt>
                <dd className="flex items-center gap-1.5 text-xs font-medium">
                  {request.screenshot_restricted ? (
                    <>
                      <Shield className="h-3.5 w-3.5 text-emerald-700" />
                      {t("screenshotBlocked")}
                    </>
                  ) : (
                    <>
                      <ShieldOff className="h-3.5 w-3.5 text-muted-foreground" />
                      {t("screenshotAllowed")}
                    </>
                  )}
                </dd>
              </div>
            </dl>
          </AppListCard>

          <AppListCard className="space-y-2 p-4">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  request.signed_at ? "bg-emerald-500" : "bg-muted-foreground/30"
                }`}
              />
              <h3 className="text-sm font-semibold">{t("proofSection")}</h3>
            </div>
            {/* Two-up so a fully populated proof record (8 fields) still fits one viewport. */}
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <Row label={t("signerName")} value={request.signer_display_name ?? "—"} />
              {proofRows.map((row) => (
                <Row
                  key={row.key}
                  label={t(`proof.${row.key}` as "proof.phone")}
                  value={row.value as string}
                />
              ))}
              {request.signed_at ? (
                <Row label={t("proof.signed_at")} value={formatStamp(request.signed_at)} />
              ) : null}
              {request.declaration_accepted_at ? (
                <Row
                  label={t("proof.declaration_accepted_at")}
                  value={formatStamp(request.declaration_accepted_at)}
                />
              ) : null}
            </dl>
            {declinedReason ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
                <p className="text-[10px] font-semibold text-destructive">
                  {t("declineReasonLabel")}
                </p>
                <p className="mt-0.5 text-xs">{declinedReason}</p>
              </div>
            ) : null}
            {proofRows.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">{t("noSignerMeta")}</p>
            ) : null}
          </AppListCard>

          {links?.signedDocumentUrl || canPlace ? (
            <Button
              type="button"
              className="h-9 w-full"
              onClick={() => {
                void openSigned("attachment");
              }}
            >
              <Download className="me-1.5 h-3.5 w-3.5" />
              {t("downloadSignedCopy")}
            </Button>
          ) : request.status === "signed" ? (
            <p
              className={
                links?.signedDocumentError
                  ? "rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[10px] text-destructive"
                  : "rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-800"
              }
            >
              {links?.signedDocumentError
                ? t("signedCopyFailed", { reason: links.signedDocumentError })
                : t("signedCopyPending")}
            </p>
          ) : null}
          <Button
            type="button"
            variant={links?.signedDocumentUrl ? "outline" : "default"}
            className="h-9 w-full"
            disabled={!links?.documentUrl}
            render={
              links?.documentUrl ? (
                <a
                  href={esignDocumentHref(request.id, "document", "attachment")}
                  target="_blank"
                  rel="noreferrer"
                />
              ) : undefined
            }
          >
            <Download className="me-1.5 h-3.5 w-3.5" />
            {t("downloadDocument")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-9 w-full"
            disabled={!links?.signatureUrl}
            render={
              links?.signatureUrl ? (
                <a
                  href={esignDocumentHref(request.id, "signature", "attachment")}
                  target="_blank"
                  rel="noreferrer"
                />
              ) : undefined
            }
          >
            <Download className="me-1.5 h-3.5 w-3.5" />
            {t("downloadSignature")}
          </Button>
        </div>
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-md" showCloseButton>
          <div className="space-y-2 px-5 pt-4">
            <Label>{t("rejectReason")}</Label>
            <Textarea
              className="min-h-24"
              value={rejectReason}
              placeholder={t("rejectReasonPlaceholder")}
              onChange={(event) => setRejectReason(event.target.value)}
            />
          </div>
          <div className="px-5 pb-4">
            <AppModalFooter title={t("reject")} subtitle={t("rejectReason")}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => setRejectOpen(false)}
              >
                {t("back")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="h-9"
                disabled={busy || !rejectReason.trim()}
                onClick={() => void decide("reject")}
              >
                {t("reject")}
              </Button>
            </AppModalFooter>
          </div>
        </DialogContent>
      </Dialog>
    </AppPage>
  );
}
