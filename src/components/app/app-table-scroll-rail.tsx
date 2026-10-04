"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * QA #18 — a wide list's only horizontal scrollbar sits at the bottom of the
 * table, below every row, so on a 14" laptop the operator has to scroll the page
 * to the bottom before they can pan sideways and then scroll back up to read the
 * row they just moved. This mirrors the table's own scroller into a slim,
 * always-visible rail directly above the header row.
 *
 * It is a real scroll container rather than a hand-positioned thumb, because then
 * RTL is the browser's problem: the rail and the table scroller share geometry
 * (same client width, same content width) and both inherit the same `dir`, so
 * `scrollLeft` on one is byte-identical to `scrollLeft` on the other. Mirroring
 * is therefore a straight copy in either direction, with no per-browser
 * negative-RTL-scrollLeft arithmetic, and drag / track-click / wheel / keyboard /
 * programmatic scroll all stay in sync because every one of them fires `scroll`.
 *
 * Rendered as a sibling *before* the `Table`, which is what keeps it pinned above
 * the header row; `ui/table.tsx` owns the body's own `overflow-x-auto`
 * (`[data-slot="table-container"]`), which this finds on its own.
 */
export function AppTableScrollRail({ className }: { className?: string }) {
  const t = useTranslations("common");
  const railRef = useRef<HTMLDivElement>(null);
  /** 0 means "the table fits — render nothing at all", so no height is added. */
  const [contentWidth, setContentWidth] = useState(0);

  useEffect(() => {
    const rail = railRef.current;
    const body = rail?.parentElement?.querySelector<HTMLElement>(
      '[data-slot="table-container"]',
    );
    if (!rail || !body) return;

    const measure = () => {
      // The table is wider than its scroller? Then the rail has work to do.
      const overflow = body.scrollWidth - body.clientWidth;
      setContentWidth(overflow > 1 ? body.scrollWidth : 0);
    };

    measure();
    const observer = new ResizeObserver(measure);
    // `body` covers the container being resized (sidebar, window); the table
    // covers its natural width changing (columns, longer cell content).
    observer.observe(body);
    const table = body.querySelector("table");
    if (table) observer.observe(table);
    window.addEventListener("resize", measure, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    if (contentWidth === 0) return;
    const rail = railRef.current;
    const body = rail?.parentElement?.querySelector<HTMLElement>(
      '[data-slot="table-container"]',
    );
    if (!rail || !body) return;

    // Setting `scrollLeft` to the value it already holds fires no `scroll`, so
    // each direction converges in one hop and the two can never oscillate.
    const mirror = (from: HTMLElement, to: HTMLElement) => {
      if (to.scrollLeft !== from.scrollLeft) to.scrollLeft = from.scrollLeft;
    };
    const fromBody = () => mirror(body, rail);
    const fromRail = () => mirror(rail, body);

    // Seed from wherever the table already is (first paint, or a restored scroll).
    mirror(body, rail);
    body.addEventListener("scroll", fromBody, { passive: true });
    rail.addEventListener("scroll", fromRail, { passive: true });
    return () => {
      body.removeEventListener("scroll", fromBody);
      rail.removeEventListener("scroll", fromRail);
    };
  }, [contentWidth]);

  return (
    <div
      ref={railRef}
      /*
       * A real scroll container, not a hand-positioned thumb, so pointer drag, track
       * click, wheel and keyboard arrows are all the platform's own behaviour.
       *
       * Focusable and labelled on purpose: the table's own scroller carries no tab stop in
       * every browser, so this is the one keyboard-and-pointer access point for panning a
       * wide list from the top of it. When the table fits, `hidden` takes the rail out of
       * layout (and out of the tab order with it), so it only ever costs a tab stop on the
       * tables that actually overflow.
       */
      role="group"
      aria-label={t("tableScroll")}
      tabIndex={0}
      className={cn(
        "block h-2.5 overflow-x-auto overflow-y-hidden overscroll-x-contain bg-card",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        // Firefox.
        "[scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent]",
        // WebKit/Blink. A styled scrollbar is painted even when the OS would
        // otherwise overlay or auto-hide it, which is what makes it visible.
        "[&::-webkit-scrollbar]:h-2.5",
        "[&::-webkit-scrollbar]:bg-transparent",
        "[&::-webkit-scrollbar-track]:bg-transparent",
        "[&::-webkit-scrollbar-thumb]:rounded-full",
        "[&::-webkit-scrollbar-thumb]:bg-border",
        "[&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/40",
        contentWidth === 0 && "hidden",
        className,
      )}
    >
      {/* The scrolled content: a zero-height spacer exactly as wide as the table. */}
      <div style={{ width: contentWidth }} className="h-px" />
    </div>
  );
}
