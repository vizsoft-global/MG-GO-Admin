"use client";

import { useEffect, useRef } from "react";

/**
 * A `setInterval` that stops while the tab is hidden and catches up the moment it returns.
 *
 * The panel's live surfaces all re-read the clock on a timer so relative times stay honest
 * ("Last fix 12m ago", GPS freshness). A plain `setInterval` keeps firing for a hidden tab,
 * and each tick calls a state setter — so every one of these was re-rendering a live tree,
 * some of them virtualized lists of hundreds of drivers, once a second to once a minute,
 * for an operator who was by definition not looking at it.
 *
 * Paused is not the same as stopped: the callback runs once on the way back in, so the
 * screen is correct immediately rather than after the next full interval. That catch-up is
 * what makes the pause unobservable — without it, returning to a 30s ticker would show a
 * stale age for up to 30s, which is the same bug in a smaller window.
 *
 * `delayMs` is the only dependency that rebuilds the interval. The callback is held in a
 * ref, so an inline arrow (which every call site uses) does not restart the timer on each
 * render — restarting would reset the phase and, for a 1s ticker, could starve it entirely
 * under a busy render loop.
 */
export function useVisibleInterval(callback: () => void, delayMs: number): void {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    const run = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      callbackRef.current();
    };

    const handle = window.setInterval(run, delayMs);
    // Deliberately checks `hidden` rather than assuming visible: the event also fires on
    // the way *out*, and firing the callback there would be the exact work being avoided.
    const onVisibility = () => {
      if (typeof document === "undefined" || document.hidden) return;
      callbackRef.current();
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(handle);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [delayMs]);
}
