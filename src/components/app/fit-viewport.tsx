"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The shell's bottom gutter (`LAYOUT.commandPageInset`, 12px). */
const BOTTOM_GUTTER_PX = 12;
const MIN_HEIGHT_PX = 320;

/** The height that takes a box from where its top is to the bottom of the window. */
export function fitHeight(top: number, windowHeight: number, gutter = BOTTOM_GUTTER_PX): number {
  return Math.max(MIN_HEIGHT_PX, Math.floor(windowHeight - top - gutter));
}

/**
 * A box exactly as tall as the screen has left under it.
 *
 * A docked table used to be one whole viewport tall and sticky, with the page
 * chrome above it scrolling separately: two vertical scrollbars, the page's and
 * the table's. Sized to the space that is actually left, the page has nothing to
 * scroll and the table's own scroller is the only one.
 *
 * The top is measured, not assumed, so the chrome above can be any height (and
 * can change: a banner, a wrapped toolbar) without a number to keep in step.
 */
export function FitViewport({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Position in the document, so a page that has been scrolled does not shrink the box.
        const top = el.getBoundingClientRect().top + window.scrollY;
        setHeight((prev) => {
          const next = fitHeight(top, window.innerHeight);
          return prev === next ? prev : next;
        });
      });
    };
    measure();
    window.addEventListener("resize", measure);
    // Chrome above the box changing height (KPI strip loading, a banner) moves its top.
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      data-fit-viewport=""
      className={cn("flex min-h-[320px] flex-col", className)}
      // Until measured, the old full-viewport height: never a collapsed table.
      style={{ height: height == null ? "calc(100dvh - 0.75rem)" : `${height}px` }}
    >
      {children}
    </div>
  );
}
