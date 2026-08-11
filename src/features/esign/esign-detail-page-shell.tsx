"use client";

import { useTranslations } from "next-intl";
import { ArrowLeft, Download, FileText, Loader2, Shield, ShieldOff } from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { useEsignDocumentLinks, useEsignRequestDetail } from "./use-esign";
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

/** Signature proof keys the driver app writes into `esign_requests.signer_meta`. */
const PROOF_KEYS = [
  "employee_id",
  "phone",
  "civil_id",
  "company",
  "ip_address",
  "device",
] as const;

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
  const { data, isLoading } = useEsignRequestDetail(requestId);
  const { data: links } = useEsignDocumentLinks(requestId);
  const request = data?.request;

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
        <Button variant="outline" className="h-9" render={<Link href="/requests/esign/sent" />}>
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            render={<Link href="/requests/esign/sent" />}
          >
            <ArrowLeft className="me-1.5 h-3.5 w-3.5" />
            {t("back")}
          </Button>
        }
      />

      <div className="grid gap-2 lg:grid-cols-[1fr,320px] lg:items-start">
        <AppListCard className="flex min-h-[420px] flex-col gap-3 bg-muted/30 p-4">
          {links?.documentUrl ? (
            <iframe
              src={links.documentUrl}
              title={request.title || request.request_code}
              className="h-[520px] w-full rounded-lg border border-border bg-card"
            />
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
            <ol className="space-y-2">
              <li className="flex items-start gap-2">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                <div>
                  <p className="text-xs font-medium">{t("timelineSent")}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {formatStamp(request.created_at)}
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                    request.signed_at ? "bg-emerald-500" : "bg-muted-foreground/30"
                  }`}
                />
                <div>
                  <p className="text-xs font-medium">{t("timelineSigned")}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {request.signed_at ? formatStamp(request.signed_at) : t("timelinePending")}
                  </p>
                </div>
              </li>
            </ol>
            <p className="border-t border-border pt-2 text-[10px] text-muted-foreground">
              {t("timelineViewedGap")}
            </p>
          </AppListCard>

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
              <Row label={t("signedAt")} value={formatStamp(request.signed_at)} />
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
            <dl className="space-y-1.5">
              <Row label={t("signerName")} value={request.signer_display_name ?? "—"} />
              {proofRows.map((row) => (
                <Row
                  key={row.key}
                  label={t(`proof.${row.key}` as "proof.phone")}
                  value={row.value as string}
                />
              ))}
            </dl>
            {proofRows.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">{t("noSignerMeta")}</p>
            ) : null}
          </AppListCard>

          <Button
            type="button"
            className="h-9 w-full"
            disabled={!links?.documentUrl}
            render={
              links?.documentUrl ? (
                <a href={links.documentUrl} target="_blank" rel="noreferrer" />
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
                <a href={links.signatureUrl} target="_blank" rel="noreferrer" />
              ) : undefined
            }
          >
            <Download className="me-1.5 h-3.5 w-3.5" />
            {t("downloadSignature")}
          </Button>
        </div>
      </div>
    </AppPage>
  );
}
