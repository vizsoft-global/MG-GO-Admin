"use client";

import type { ReactNode } from "react";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";

export function AppModalFooter({
  title,
  subtitle,
  meta,
  children,
  asPage = false,
}: {
  title: string;
  subtitle?: string;
  meta?: ReactNode;
  children?: ReactNode;
  /** Use on full pages — DialogTitle/Description require a Dialog ancestor */
  asPage?: boolean;
}) {
  return (
    <div className="shrink-0 rounded-xl border border-border bg-background px-5 py-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          {asPage ? (
            <>
              <p className="truncate text-sm font-semibold leading-tight text-foreground">{title}</p>
              {subtitle ? (
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                  {subtitle}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <DialogTitle className="truncate text-sm font-semibold leading-tight text-foreground">
                {title}
              </DialogTitle>
              {subtitle ? (
                <DialogDescription className="mt-0.5 line-clamp-1 text-[11px] leading-snug">
                  {subtitle}
                </DialogDescription>
              ) : null}
            </>
          )}
          {meta ? <div className="mt-1 text-[11px] text-muted-foreground">{meta}</div> : null}
        </div>
        {children ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
        ) : null}
      </div>
    </div>
  );
}
