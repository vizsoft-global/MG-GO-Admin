"use client";

import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2, Shield, ShieldOff } from "lucide-react";
import { AppPage, AppPageHeader } from "@/components/app";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { useEsignRequestDetail } from "./use-esign";
import type { EsignRequestStatus } from "./types";

function statusVariant(
  status: EsignRequestStatus,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "signed") return "success";
  if (status === "expired" || status === "cancelled") return "danger";
  if (status === "pending") return "warning";
  return "neutral";
}

export function EsignDetailPageShell({ requestId }: { requestId: string }) {
  const t = useTranslations("pages.requests.esign.detail");
  const tCommon = useTranslations("pages.requests.esign");
  const { data, isLoading } = useEsignRequestDetail(requestId);
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

  const metaEntries = Object.entries(request.signer_meta ?? {}).filter(
    ([, v]) => v != null && String(v).trim() !== "",
  );

  return (
    <AppPage>
      <AppPageHeader
        title={request.request_code}
        description={request.title}
        breadcrumbs={[
          { label: tCommon("hub.requests"), href: "/requests" },
          { label: tCommon("hub.title"), href: "/requests/esign" },
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

      <div className="grid gap-2 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">
            {t("overview")}
          </h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("status")}</dt>
              <dd>
                <StatusPill variant={statusVariant(request.status)}>
                  {tCommon(`status.${request.status}`)}
                </StatusPill>
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("driver")}</dt>
              <dd className="text-end">
                {request.driver_name}
                <span className="ms-1 font-mono text-[11px] text-muted-foreground">
                  {request.driver_code}
                </span>
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("category")}</dt>
              <dd>{request.category_label ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("due")}</dt>
              <dd className="tabular-nums">{request.due_at ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("created")}</dt>
              <dd className="tabular-nums">
                {new Date(request.created_at).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </dd>
            </div>
            {request.signed_at ? (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("signedAt")}</dt>
                <dd className="tabular-nums">
                  {new Date(request.signed_at).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">
            {t("signerSection")}
          </h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("signerName")}</dt>
              <dd>{request.signer_display_name ?? "—"}</dd>
            </div>
            <div className="flex items-start justify-between gap-2">
              <dt className="text-muted-foreground">{t("screenshot")}</dt>
              <dd className="flex items-center gap-1.5 text-end">
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
            {metaEntries.length > 0 ? (
              <div className="border-t border-border pt-2">
                <dt className="mb-1 text-muted-foreground">{t("signerMeta")}</dt>
                <dd className="space-y-1">
                  {metaEntries.map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-2 text-[11px]">
                      <span className="font-mono text-muted-foreground">{key}</span>
                      <span>{String(value)}</span>
                    </div>
                  ))}
                </dd>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">{t("noSignerMeta")}</p>
            )}
          </dl>
        </div>
      </div>
    </AppPage>
  );
}
