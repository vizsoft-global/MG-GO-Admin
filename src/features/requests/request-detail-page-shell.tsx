"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppPage, AppPageHeader } from "@/components/app";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/auth-context";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { useAdminRequestDetail, useDecideRequest } from "./use-requests";

function statusVariant(
  status: string,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "approved" || status === "solved") return "success";
  if (status === "rejected") return "danger";
  if (status === "needs_clarification" || status === "overdue") return "warning";
  return "neutral";
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
  const closed =
    request?.status === "approved" ||
    request?.status === "rejected" ||
    request?.status === "solved";

  const runAction = async (action: string, requireReason = false) => {
    if (requireReason && !reason.trim()) {
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
        <Button variant="outline" className="h-9" render={<Link href="/requests" />}>
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
            <StatusPill variant={statusVariant(request.status)}>
              {t(`status.${request.status}` as "status.pending")}
            </StatusPill>
            <Button variant="outline" size="sm" className="h-9" render={<Link href="/requests" />}>
              <ArrowLeft className="me-1.5 h-3.5 w-3.5" />
              {t("detail.back")}
            </Button>
          </div>
        }
      />

      <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
        <section className="h-full rounded-xl border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold">{t("detail.fields")}</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("colDriver")}</dt>
              <dd>
                <Link
                  href={`/drivers/${request.driver_id}`}
                  className="text-primary hover:underline"
                >
                  {request.driver_id.slice(0, 8)}…
                </Link>
              </dd>
            </div>
            {request.amount_kwd != null ? (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("colAmount")}</dt>
                <dd className="tabular-nums">{request.amount_kwd}</dd>
              </div>
            ) : null}
            {request.start_date ? (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("detail.from")}</dt>
                <dd>
                  {request.start_date}
                  {request.end_date ? ` → ${request.end_date}` : ""}
                </dd>
              </div>
            ) : null}
            {request.details ? (
              <div>
                <dt className="text-muted-foreground">{t("detail.notes")}</dt>
                <dd className="mt-1 whitespace-pre-wrap">{request.details}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-muted-foreground">{t("detail.payload")}</dt>
              <dd className="mt-1 max-h-40 overflow-auto rounded-lg bg-muted/40 p-2 text-[11px] font-mono">
                {JSON.stringify(request.payload, null, 2)}
              </dd>
            </div>
          </dl>
        </section>

        <section className="h-full rounded-xl border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold">{t("detail.approval")}</h2>
          <ol className="space-y-2">
            {steps.map((step) => (
              <li
                key={step.id}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm",
                  step.status === "in_progress" &&
                    "border-emerald-500 bg-emerald-50 text-emerald-900",
                  step.status === "completed" && "border-border bg-muted/30",
                  step.status === "rejected" &&
                    "border-destructive/40 bg-destructive/5",
                  step.status === "pending" && "border-border text-muted-foreground",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {step.step_order}. {step.step_name}
                  </span>
                  <span className="text-[11px] uppercase tracking-wide">
                    {step.status}
                  </span>
                </div>
                {step.decision_note ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {step.decision_note}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>

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
                    <p className="mt-1 text-amber-700">{t("detail.awaitingAnswer")}</p>
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
            <Button
              type="button"
              className="h-9"
              disabled={decide.isPending}
              onClick={() => void runAction("approve")}
            >
              {t("detail.approve")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9 text-destructive hover:bg-destructive/10"
              disabled={decide.isPending}
              onClick={() => void runAction("reject", true)}
            >
              {t("detail.reject")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9"
              disabled={decide.isPending}
              onClick={() => void runAction("clarify", true)}
            >
              {t("detail.clarify")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9"
              disabled={decide.isPending}
              onClick={() => void runAction("solve")}
            >
              {t("detail.solve")}
            </Button>
          </div>
        </section>
      ) : null}
    </AppPage>
  );
}
