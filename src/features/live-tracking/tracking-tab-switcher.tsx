"use client";

import type { ReactNode } from "react";
import { History, ListChecks, Stethoscope } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export type TrackingViewTab = "live" | "history" | "activity" | "diagnostics";

export function TrackingTabSwitcher({
  value,
  onChange,
  className,
  showActivity = false,
  showDiagnostics = false,
}: {
  value: TrackingViewTab;
  onChange: (tab: TrackingViewTab) => void;
  className?: string;
  /** Activity reads the wider driver_ops audit surface, so it is permission-gated. */
  showActivity?: boolean;
  /** Diagnostics reads client telemetry, gated on driver_telemetry.view. */
  showDiagnostics?: boolean;
}) {
  const t = useTranslations("pages.liveTracking");
  const tabCount = 2 + (showActivity ? 1 : 0) + (showDiagnostics ? 1 : 0);

  return (
    <div
      className={cn(
        "w-full gap-1 rounded-lg border border-border bg-muted/30 p-0.5",
        // The command sidebar is 240px at 1366px, so four labels cannot share one
        // row without clipping. Wrap to 2x2 rather than truncating a label.
        tabCount > 3 ? "grid grid-cols-2" : "inline-flex items-center",
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
      {showActivity ? (
        <TabButton active={value === "activity"} onClick={() => onChange("activity")}>
          <ListChecks
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              value === "activity" ? "text-foreground" : "text-muted-foreground",
            )}
          />
          {t("tabActivity")}
        </TabButton>
      ) : null}
      {showDiagnostics ? (
        <TabButton
          active={value === "diagnostics"}
          onClick={() => onChange("diagnostics")}
        >
          <Stethoscope
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              value === "diagnostics" ? "text-foreground" : "text-muted-foreground",
            )}
          />
          {t("tabDiagnostics")}
        </TabButton>
      ) : null}
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
        "inline-flex h-8 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-semibold transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
