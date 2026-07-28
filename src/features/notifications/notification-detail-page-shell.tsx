"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Copy, Send, ShieldCheck, ShieldX, XCircle } from "lucide-react";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { AppListCard } from "@/components/app/app-list-card";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";
import {
  approveNotificationCampaign,
  cancelNotificationCampaign,
  cloneNotificationCampaign,
  dispatchNotificationCampaign,
  rejectNotificationCampaign,
} from "./notifications-actions";
import { useNotificationCampaign, useNotificationDispatchItems } from "./use-notifications";
import { previewPayloadSchema, buildActionPayload } from "./payload-contract";
import { pickNotificationMediaByRole } from "./notification-media";
import { NotificationMediaPreview } from "./notification-media-preview";
import { NotificationMobilePreview } from "./notification-mobile-preview";
import { NotificationEngagementReport } from "./notification-engagement-report";
import { invalidateNotificationCaches } from "./invalidate-notification-caches";

export function NotificationDetailPageShell({ campaignId }: { campaignId: string }) {
  const t = useTranslations("pages.notifications");
  const locale = useLocale();
  const router = useRouter();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();
  const { data: campaign, isLoading, refetch } = useNotificationCampaign(campaignId);
  const { data: dispatchItems, refetch: refetchDispatch } = useNotificationDispatchItems(campaignId);

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
  );
  const bannerMedia = pickNotificationMediaByRole(campaign.media, "banner");
  const pushImageMedia = pickNotificationMediaByRole(campaign.media, "image");
  const noTokenCount = dispatchItems?.filter((item) => item.error_code === "no_token").length ?? 0;
  const canRetrySend = canSend && ["draft", "queued", "scheduled", "pending_approval", "failed"].includes(campaign.status);

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
                      toast.success(t("sentSuccess", { sent: result.sent, failed: result.failed }));
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
            <StatusPill variant="warning">{campaign.status.replace("_", " ")}</StatusPill>
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
            {campaign.status === "failed" && campaign.failed_count > 0 ? (
              <p className="sm:col-span-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive">
                {noTokenCount > 0 && noTokenCount === (dispatchItems?.length ?? 0)
                  ? t("dispatchAllNoToken", { count: noTokenCount })
                  : t("dispatchFailedSummary", {
                      failed: campaign.failed_count,
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
