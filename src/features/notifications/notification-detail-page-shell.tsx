"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Copy, Send, ShieldCheck, ShieldOff, ShieldX, XCircle } from "lucide-react";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { AppListCard } from "@/components/app/app-list-card";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";
import { dispatchToastCopy } from "./dispatch-toast";
import {
  approveNotificationCampaign,
  cancelNotificationCampaign,
  cloneNotificationCampaign,
  dispatchNotificationCampaign,
  rejectNotificationCampaign,
} from "./notifications-actions";
import {
  useCampaignScreenshotEvents,
  useNotificationCampaign,
  useNotificationDispatchItems,
} from "./use-notifications";
import { previewPayloadSchema, buildActionPayload } from "./payload-contract";
import { pickNotificationMediaByRole } from "./notification-media";
import { NotificationMediaPreview } from "./notification-media-preview";
import { NotificationMobilePreview } from "./notification-mobile-preview";
import { NotificationEngagementReport } from "./notification-engagement-report";
import { invalidateNotificationCaches } from "./invalidate-notification-caches";
import {
  resolveCampaignDisplayStatus,
  summarizeDispatchOutcomes,
} from "./dispatch-outcome";

function formatEventTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kuwait",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function NotificationDetailPageShell({ campaignId }: { campaignId: string }) {
  const t = useTranslations("pages.notifications");
  const locale = useLocale();
  const router = useRouter();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();
  const { data: campaign, isLoading, refetch } = useNotificationCampaign(campaignId);
  const { data: dispatchItems, refetch: refetchDispatch } = useNotificationDispatchItems(campaignId);
  const { data: screenshotEvents } = useCampaignScreenshotEvents(campaignId);

  const canSend = auth.can("notifications.send");
  const canApprove = auth.can("notifications.approve");
  const canManage = auth.can("notifications.manage");

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!campaign) {
    return <p className="py-12 text-center text-sm text-muted-foreground">{t("notFound")}</p>;
  }

  const awaitingApproval =
    campaign.requires_approval &&
    !campaign.approved_at &&
    (campaign.status === "pending_approval" || campaign.status === "draft");

  const payloadPreview = previewPayloadSchema(
    buildActionPayload({
      actionType: campaign.action_type,
      actionParams: campaign.action_params,
      campaignId: campaign.id,
    }),
    campaign.media,
    campaign.screenshot_restricted,
  );
  const bannerMedia = pickNotificationMediaByRole(campaign.media, "banner");
  const pushImageMedia = pickNotificationMediaByRole(campaign.media, "image");
  const dispatchSummary = summarizeDispatchOutcomes(dispatchItems ?? []);
  const displayStatus = resolveCampaignDisplayStatus(
    campaign.status,
    dispatchItems ?? [],
  );
  const canRetrySend =
    canSend &&
    (["draft", "queued", "scheduled", "pending_approval", "failed"].includes(
      campaign.status,
    ) ||
      dispatchSummary.allPushSkipped ||
      dispatchSummary.pushSkipped > 0);

  return (
    <AppPage narrow>
      <AppPageHeader
        title={campaign.title}
        description={campaign.body}
        breadcrumbs={[
          { label: t("title"), href: `/${locale}/notifications` },
          { label: campaign.title },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            {awaitingApproval && canApprove ? (
              <>
                <Button
                  className="h-9 cursor-pointer"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await approveNotificationCampaign(campaign.id);
                      if ("error" in result) toast.error(t("errors.saveFailed"));
                      else {
                        toast.success(t("approvedSuccess"));
                        await invalidateNotificationCaches(queryClient, { campaignId: campaign.id });
                        void refetch();
                      }
                    })
                  }
                >
                  <ShieldCheck className="size-4" />
                  {t("approve")}
                </Button>
                <Button
                  variant="outline"
                  className="h-9 cursor-pointer text-destructive"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await rejectNotificationCampaign(campaign.id);
                      if ("error" in result) toast.error(t("errors.saveFailed"));
                      else {
                        toast.success(t("rejectedSuccess"));
                        await invalidateNotificationCaches(queryClient, { campaignId: campaign.id });
                        void refetch();
                      }
                    })
                  }
                >
                  <ShieldX className="size-4" />
                  {t("reject")}
                </Button>
              </>
            ) : null}
            {canRetrySend ? (
              <Button
                className="h-9 cursor-pointer"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await dispatchNotificationCampaign(campaign.id);
                    if ("error" in result) toast.error(t(`errors.${result.error}`));
                    else {
                      const copy = dispatchToastCopy(result);
                      toast[copy.kind](
                        t(copy.key, {
                          sent: result.sent,
                          failed: result.failed,
                          skipped: result.skipped,
                        }),
                      );
                      await invalidateNotificationCaches(queryClient, { campaignId: campaign.id });
                      void refetch();
                      void refetchDispatch();
                    }
                  })
                }
              >
                <Send className="size-4" />
                {campaign.status === "failed" ? t("retrySend") : t("sendNow")}
              </Button>
            ) : null}
            {canManage ? (
              <>
                <Button
                  variant="outline"
                  className="h-9 cursor-pointer"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await cloneNotificationCampaign(campaign.id);
                      if ("error" in result) toast.error(t("errors.saveFailed"));
                      else {
                        toast.success(t("clonedSuccess"));
                        await invalidateNotificationCaches(queryClient, { campaignId: result.id });
                        router.push(`/${locale}/notifications/${result.id}`);
                      }
                    })
                  }
                >
                  <Copy className="size-4" />
                  {t("clone")}
                </Button>
                {["draft", "pending_approval", "scheduled", "queued"].includes(campaign.status) ? (
                  <Button
                    variant="outline"
                    className="h-9 cursor-pointer text-destructive"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await cancelNotificationCampaign(campaign.id);
                        if ("error" in result) toast.error(t("errors.saveFailed"));
                        else {
                          toast.success(t("cancelledSuccess"));
                          await invalidateNotificationCaches(queryClient, { campaignId: campaign.id });
                          void refetch();
                        }
                      })
                    }
                  >
                    <XCircle className="size-4" />
                    {t("cancelCampaign")}
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        }
      />

      <AppListCard title={t("detailOverview")}>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            <StatusPill variant="neutral">{campaign.category}</StatusPill>
            <StatusPill variant="neutral">{campaign.priority}</StatusPill>
            <StatusPill
              variant={
                displayStatus === "failed"
                  ? "danger"
                  : displayStatus === "sent" ||
                      displayStatus === "delivered" ||
                      displayStatus === "opened" ||
                      displayStatus === "clicked"
                    ? "success"
                    : "warning"
              }
            >
              {displayStatus.replace("_", " ")}
            </StatusPill>
            {campaign.screenshot_restricted ? (
              <span className="inline-flex items-center gap-0.5 rounded-md border border-amber-200 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                <ShieldOff className="size-3" aria-hidden />
                {t("screenshotRestrictedBadge")}
              </span>
            ) : null}
          </div>
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <p>
              <span className="text-muted-foreground">{t("colAudience")}: </span>
              {campaign.recipient_count || campaign.estimated_audience_count}
            </p>
            <p>
              <span className="text-muted-foreground">{t("colSent")}: </span>
              {campaign.sent_at ?? "—"}
            </p>
            {dispatchSummary.pushSkipped > 0 ? (
              <p className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                {dispatchSummary.allPushSkipped
                  ? t("dispatchAllNoTokenInAppOk", { count: dispatchSummary.pushSkipped })
                  : t("dispatchSomeNoTokenInAppOk", {
                      skipped: dispatchSummary.pushSkipped,
                      total: dispatchItems?.length ?? campaign.recipient_count,
                    })}
              </p>
            ) : null}
            {dispatchSummary.hardFailed > 0 ? (
              <p className="sm:col-span-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive">
                {dispatchSummary.inboxDelivered > 0
                  ? t("dispatchPushFailedInAppOk", {
                      failed: dispatchSummary.hardFailed,
                      total: campaign.recipient_count || campaign.estimated_audience_count,
                    })
                  : t("dispatchFailedSummary", {
                      failed: dispatchSummary.hardFailed,
                      total: campaign.recipient_count || campaign.estimated_audience_count,
                    })}
              </p>
            ) : null}
          </div>
          {dispatchItems && dispatchItems.length > 0 ? (
            <NotificationEngagementReport
              campaignId={campaign.id}
              items={dispatchItems}
              trackEngagement={campaign.track_engagement ?? true}
            />
          ) : null}
          <div className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-accent">{t("screenshotAttemptsTitle")}</p>
              <span className="text-xs text-muted-foreground">
                {t("screenshotAttemptsCount", { count: screenshotEvents?.length ?? 0 })}
              </span>
            </div>
            {!screenshotEvents?.length ? (
              <p className="text-xs text-muted-foreground">{t("screenshotAttemptsEmpty")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("screenshotColDriver")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("screenshotColPlatform")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("screenshotColTime")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {screenshotEvents.map((event) => {
                    const platform =
                      typeof event.metadata?.platform === "string"
                        ? event.metadata.platform
                        : "—";
                    return (
                      <TableRow key={event.id}>
                        <TableCell className="text-sm">
                          {event.driver_code ?? "—"}
                          {event.driver_name ? (
                            <span className="block text-xs text-muted-foreground">
                              {event.driver_name}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm capitalize">{platform}</TableCell>
                        <TableCell className="text-sm">{formatEventTime(event.occurred_at)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
          <NotificationMobilePreview
            title={campaign.title}
            body={campaign.body}
            category={campaign.category}
            bannerObjectKey={bannerMedia?.object_key ?? null}
            pushImageObjectKey={pushImageMedia?.object_key ?? null}
            actionType={campaign.action_type}
            actionFields={{}}
          />
          {bannerMedia ? (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">{t("fieldBanner")}</p>
              <NotificationMediaPreview objectKey={bannerMedia.object_key} alt={t("fieldBanner")} />
            </div>
          ) : null}
          {pushImageMedia ? (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">{t("fieldPushImage")}</p>
              <NotificationMediaPreview
                objectKey={pushImageMedia.object_key}
                alt={t("fieldPushImage")}
                className="h-32 max-w-xs rounded-lg object-cover"
              />
            </div>
          ) : null}
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted/20 p-3 text-xs">
            {payloadPreview}
          </pre>
          <Button
            render={<Link href={`/${locale}/notifications`} />}
            variant="outline"
            className="h-9 cursor-pointer"
          >
            {t("backToCenter")}
          </Button>
        </CardContent>
      </AppListCard>
    </AppPage>
  );
}
