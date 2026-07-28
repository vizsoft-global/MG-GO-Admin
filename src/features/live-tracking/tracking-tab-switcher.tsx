"use client";

import type { ReactNode } from "react";
import { History } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export type TrackingViewTab = "live" | "history";

export function TrackingTabSwitcher({
  value,
  onChange,
  className,
}: {
  value: TrackingViewTab;
  onChange: (tab: TrackingViewTab) => void;
  className?: string;
}) {
  const t = useTranslations("pages.liveTracking");

  return (
    <div
      className={cn(
        "inline-flex w-full items-center gap-1 rounded-lg border border-border bg-muted/30 p-0.5",
        className,
      )}
    >
      <TabButton active={value === "live"} onClick={() => onChange("live")}>
        <span className="relative flex h-2 w-2 shrink-0">
          {value === "live" ? (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          ) : null}
          <span
            className={cn(
              "relative inline-flex h-2 w-2 rounded-full",
              value === "live" ? "bg-emerald-500" : "bg-emerald-500/50",
            )}
          />
        </span>
        {t("tabLive")}
      </TabButton>
      <TabButton active={value === "history"} onClick={() => onChange("history")}>
        <History
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            value === "history" ? "text-foreground" : "text-muted-foreground",
          )}
        />
        {t("tabHistory")}
      </TabButton>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
