"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * How far down the table's own scroller before the button is worth showing.
 *
 * Roughly two screens of rows: above that the first record is still on screen or
 * one flick away, so the control would be chrome with nothing to do.
 */
const SHOW_AFTER_PX = 160;

/**
 * "Back to top" for a table that owns its own vertical scroll.
 *
 * The button lives in a zero-height, `sticky bottom-*` row *after* the scroll
 * viewport rather than inside it, for two reasons:
 *
 * - Inside `[data-table-scroll]` it would scroll away with the rows it is meant
 *   to escape, and an `absolute` child of a scroller is positioned in the
 *   scrolled content, so it would leave the screen exactly when it is needed.
 * - `sticky` on the row pins it to the bottom edge of whatever is scrolling —
 *   the table's viewport once the table is docked, `<main>` while the page
 *   still has chrome above it — and it costs no layout height (`h-0`).
 *
 * The click is a real `scrollTo` on the table's scroller, so it lands on the
 * first row with the header still pinned and never touches the page scroll, the
 * URL, the filters or the pager.
 */
export function AppTableBackToTop({ className }: { className?: string }) {
  const t = useTranslations("common");
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const scroller = findScroller(hostRef.current);
    if (!scroller) return;

    const measure = () => setVisible(scroller.scrollTop > SHOW_AFTER_PX);
    measure();

    scroller.addEventListener("scroll", measure, { passive: true });
    // A filter that shortens the list while the operator is scrolled down can
    // leave `scrollTop` above the new maximum; the browser clamps it silently
    // and does not fire `scroll` on every engine, so re-read on content resize.
    const observer = new ResizeObserver(measure);
    const table = scroller.querySelector("table");
    if (table) observer.observe(table);
    observer.observe(scroller);

    return () => {
      scroller.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, []);

  const toTop = useCallback(() => {
    const scroller = findScroller(hostRef.current);
    if (!scroller) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({
      top: 0,
      left: scroller.scrollLeft,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, []);

  return (
    <div
      ref={hostRef}
      className={cn(
        "pointer-events-none sticky bottom-3 z-30 flex h-0 justify-end pe-3",
        className,
      )}
    >
      <button
        type="button"
        onClick={toTop}
        aria-label={t("backToTop")}
        title={t("backToTop")}
        tabIndex={visible ? 0 : -1}
        aria-hidden={!visible}
        className={cn(
          "pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-md",
          "transition-[opacity,background-color] duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "active:scale-[0.97]",
          visible ? "opacity-100" : "invisible opacity-0",
        )}
      >
        <ArrowUp className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/** The `[data-table-scroll]` element that owns this table's vertical scroll. */
function findScroller(host: HTMLElement | null): HTMLElement | null {
  const parent = host?.parentElement;
  if (!parent) return null;
  return parent.querySelector<HTMLElement>("[data-table-scroll]");
}
