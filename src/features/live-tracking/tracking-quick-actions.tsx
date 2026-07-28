"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { History, Siren } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TrackingGlassCard } from "./tracking-shell";

export function TrackingQuickActions({ className }: { className?: string }) {
  const t = useTranslations("pages.liveTracking");

  const actions = [
    {
      id: "playback",
      icon: History,
      label: t("actionPlayback"),
      href: null,
      enabled: false,
      hint: t("actionPlaybackHint"),
    },
    {
      id: "sos",
      icon: Siren,
      label: t("actionSos"),
      href: null,
      enabled: false,
    },
  ] as const;

  return (
    <TrackingGlassCard
      className={cn(
        "border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900",
        className,
      )}
    >
      <h3 className="mb-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
        {t("quickActions")}
      </h3>
      <div className="grid grid-cols-2 gap-1.5">
        {actions.map((action) => {
          const content = (
            <>
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-500/20 dark:text-blue-200">
                <action.icon className="h-3.5 w-3.5 shrink-0" />
              </span>
              <span className="truncate text-[11px] leading-tight text-slate-700 dark:text-slate-200">
                {action.label}
              </span>
              {!action.enabled ? (
                <Badge variant="secondary" className="h-4 rounded-full px-1.5 text-[9px]">
                  Soon
                </Badge>
              ) : null}
            </>
          );
          if (action.enabled && action.href) {
            return (
              <Button
                key={action.id}
                variant="outline"
                size="sm"
                className="h-8 cursor-pointer items-center justify-start gap-2 rounded-md border-slate-200 bg-slate-50 px-2 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:bg-slate-800"
                render={<Link href={action.href} />}
              >
                {content}
              </Button>
            );
          }
          return (
            <Button
              key={action.id}
              variant="outline"
              size="sm"
              className="h-8 items-center justify-start gap-2 rounded-md border-slate-200 bg-slate-50 px-2 dark:border-slate-700 dark:bg-slate-800/60"
              disabled
              title={"hint" in action ? action.hint : undefined}
            >
              {content}
            </Button>
          );
        })}
      </div>
    </TrackingGlassCard>
  );
}
