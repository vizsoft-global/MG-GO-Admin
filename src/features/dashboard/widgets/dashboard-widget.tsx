"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { normalizeTone, TONE_STYLES, type Tone } from "@/lib/ui/tone-styles";
import { DemoDataBadge } from "../demo-data-badge";
import { cn } from "@/lib/utils";

/** Max list items rendered inside a dashboard widget card before "View all". */
export const DASHBOARD_WIDGET_PREVIEW_LIMIT = 5;

export function DashboardWidgetEmpty({
  icon: Icon,
  title,
  hint,
  tone = "neutral",
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  tone?: Tone | string;
}) {
  const toneStyle = TONE_STYLES[normalizeTone(tone)];

  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <span
        className={cn(
          "inline-flex size-10 items-center justify-center rounded-xl",
          toneStyle.iconChip,
        )}
      >
        <Icon className="size-5" />
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint ? <p className="max-w-xs text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function DashboardWidget({
  title,
  href,
  viewAllLabel = "View all",
  icon: Icon,
  tone = "primary",
  badge,
  demo,
  demoTooltipKey,
  children,
  className,
  contentClassName,
  modalTitle,
  modalDescription,
  modalContent,
}: {
  title: string;
  href?: string;
  viewAllLabel?: string;
  icon?: LucideIcon;
  tone?: Tone | string;
  badge?: string | number;
  demo?: boolean;
  demoTooltipKey?: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  /** When provided, "View all" opens a popup with this content instead of navigating. */
  modalContent?: React.ReactNode;
  modalTitle?: string;
  modalDescription?: string;
}) {
  const toneStyle = TONE_STYLES[normalizeTone(tone)];
  const [modalOpen, setModalOpen] = useState(false);
  const hasModal = modalContent !== undefined && modalContent !== null;

  const viewAllControl = hasModal ? (
    <button
      type="button"
      onClick={() => setModalOpen(true)}
      className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
    >
      {viewAllLabel}
      <ArrowRight className="size-3.5" />
    </button>
  ) : href ? (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
    >
      {viewAllLabel}
      <ArrowRight className="size-3.5" />
    </Link>
  ) : null;

  return (
    <>
      <Card
        className={cn(
          "flex min-h-[260px] flex-col overflow-hidden rounded-xl border-border bg-card shadow-[0_1px_2px_rgba(15,15,15,0.04)]",
          className,
        )}
      >
        <CardHeader className="flex shrink-0 flex-row items-center justify-between gap-3 space-y-0 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {Icon ? (
              <span
                className={cn(
                  "inline-flex size-8 shrink-0 items-center justify-center rounded-lg",
                  toneStyle.iconChip,
                )}
              >
                <Icon className="size-4" />
              </span>
            ) : null}
            <div className="min-w-0">
              <CardTitle className="text-sm font-semibold leading-tight">{title}</CardTitle>
              {badge !== undefined ? (
                <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                  {badge}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {demo ? <DemoDataBadge tooltipKey={demoTooltipKey} /> : null}
            {viewAllControl}
          </div>
        </CardHeader>
        <CardContent className={cn("min-h-0 flex-1 overflow-auto p-0", contentClassName)}>
          {children}
        </CardContent>
      </Card>

      {hasModal ? (
        <Dialog open={modalOpen} onOpenChange={setModalOpen}>
          <DialogContent
            closeOutside
            className="w-[min(720px,96vw)] max-w-none gap-0 overflow-visible p-0"
          >
            <DialogHeader className="flex flex-row items-center gap-2.5 space-y-0 border-b border-border px-5 py-4">
              {Icon ? (
                <span
                  className={cn(
                    "inline-flex size-8 shrink-0 items-center justify-center rounded-lg",
                    toneStyle.iconChip,
                  )}
                >
                  <Icon className="size-4" />
                </span>
              ) : null}
              <div className="min-w-0">
                <DialogTitle className="text-base">{modalTitle ?? title}</DialogTitle>
                {modalDescription ? (
                  <DialogDescription className="text-xs">{modalDescription}</DialogDescription>
                ) : null}
              </div>
            </DialogHeader>
            <div className="max-h-[70vh] overflow-auto">{modalContent}</div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
