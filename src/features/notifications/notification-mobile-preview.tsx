"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { NotificationMediaPreview } from "./notification-media-preview";
import type { NotificationCategory } from "./types";
import { describeNotificationAction } from "./notification-action-presets";

type Props = {
  title: string;
  body: string;
  category?: NotificationCategory;
  bannerObjectKey?: string | null;
  pushImageObjectKey?: string | null;
  actionType?: string;
  actionFields?: Record<string, string>;
  className?: string;
};

export function NotificationMobilePreview({
  title,
  body,
  category = "announcement",
  bannerObjectKey,
  pushImageObjectKey,
  actionType = "open_screen",
  actionFields = { screen: "home" },
  className,
}: Props) {
  const t = useTranslations("pages.notifications");
  const [view, setView] = useState<"collapsed" | "expanded">("collapsed");
  const actionSummary = describeNotificationAction(actionType, actionFields, t);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex gap-1 rounded-lg border border-border bg-muted/20 p-1">
        <button
          type="button"
          className={cn(
            "flex-1 cursor-pointer rounded-md px-2 py-1 text-xs font-medium transition-colors",
            view === "collapsed" ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => setView("collapsed")}
        >
          {t("previewCollapsed")}
        </button>
        <button
          type="button"
          className={cn(
            "flex-1 cursor-pointer rounded-md px-2 py-1 text-xs font-medium transition-colors",
            view === "expanded" ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => setView("expanded")}
        >
          {t("previewExpanded")}
        </button>
      </div>
      <div className="mx-auto w-[min(280px,100%)] rounded-[2rem] border-4 border-zinc-800 bg-zinc-900 p-2 shadow-lg">
        <div className="rounded-[1.5rem] bg-zinc-100 dark:bg-zinc-950">
          {view === "collapsed" ? (
            <div className="space-y-2 p-3">
              <div className="flex items-start gap-2 rounded-xl bg-white p-2.5 shadow-sm dark:bg-zinc-900">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-[10px] font-bold text-primary-foreground">
                  DPD
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-semibold">{title || t("previewTitlePlaceholder")}</p>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{t("previewNow")}</span>
                  </div>
                  <p className="line-clamp-2 text-[11px] text-muted-foreground">
                    {body || t("previewBodyPlaceholder")}
                  </p>
                </div>
                {pushImageObjectKey ? (
                  <NotificationMediaPreview
                    objectKey={pushImageObjectKey}
                    alt=""
                    className="size-10 shrink-0 rounded-md object-cover"
                  />
                ) : null}
              </div>
            </div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              {bannerObjectKey ? (
                <NotificationMediaPreview
                  objectKey={bannerObjectKey}
                  alt=""
                  className="h-28 w-full rounded-t-[1.25rem] object-cover"
                />
              ) : (
                <div className="h-20 rounded-t-[1.25rem] bg-gradient-to-r from-primary/20 to-primary/5" />
              )}
              <div className="space-y-2 p-4">
                <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  {t(`categories.${category}`)}
                </span>
                <p className="text-sm font-semibold">{title || t("previewTitlePlaceholder")}</p>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                  {body || t("previewBodyPlaceholder")}
                </p>
                <p className="rounded-lg border border-border bg-muted/30 px-2 py-1.5 text-[10px] text-muted-foreground">
                  {actionSummary}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
