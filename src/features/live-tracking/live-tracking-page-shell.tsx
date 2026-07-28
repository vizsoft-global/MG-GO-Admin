"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Minimize2, Radio } from "lucide-react";
import { AppPage } from "@/components/app/app-page";
import { LAYOUT } from "@/components/app/layout-spacing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LiveTrackingLiveView } from "./live-tracking-live-view";
import { LiveTrackingHistoryView } from "./live-tracking-history-view";
import type { TrackingViewTab } from "./tracking-tab-switcher";

export function LiveTrackingPageShell() {
  const t = useTranslations("pages.liveTracking");
  const [isCommandFullscreen, setIsCommandFullscreen] = useState(false);
  const [activeTab, setActiveTab] = useState<TrackingViewTab>("live");

  useEffect(() => {
    if (!isCommandFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsCommandFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isCommandFullscreen]);

  const content =
    activeTab === "live" ? (
      <LiveTrackingLiveView
        fullscreen={isCommandFullscreen}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
    ) : (
      <LiveTrackingHistoryView activeTab={activeTab} onTabChange={setActiveTab} />
    );

  if (isCommandFullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-sm font-semibold">{t("commandCenter")}</h1>
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <Radio className="h-3 w-3 text-emerald-500" />
              {t("tabLive")}
            </Badge>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {t("autoRefresh")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="cursor-pointer"
              onClick={() => setIsCommandFullscreen(false)}
            >
              <Minimize2 className="me-1.5 h-4 w-4" />
              {t("exitFullscreen")}
            </Button>
          </div>
        </header>
        <div className={`min-h-0 flex-1 overflow-hidden ${LAYOUT.commandPageInset}`}>{content}</div>
      </div>
    );
  }

  return <AppPage>{content}</AppPage>;
}
