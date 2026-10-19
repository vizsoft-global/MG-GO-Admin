"use client";

import { useEffect, useState, type ComponentType } from "react";

type DevtoolsButtonPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

type ReactQueryDevtoolsComponent = ComponentType<{
  initialIsOpen?: boolean;
  buttonPosition?: DevtoolsButtonPosition;
}>;

/**
 * Dev-only TanStack Query devtools.
 *
 * Loaded with a plain dynamic import instead of `next/dynamic` so a failed
 * chunk request (stale Turbopack chunk hashes after a rebuild, a wiped
 * `.next/dev` directory, a dependency change while the server was running)
 * cannot throw during render and blank the whole dashboard. The devtools are
 * optional; the app is not.
 */
export function QueryDevtoolsWrapper() {
  const [Devtools, setDevtools] =
    useState<ReactQueryDevtoolsComponent | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    let cancelled = false;

    void import("@tanstack/react-query-devtools")
      .then((mod) => {
        if (cancelled) return;
        setDevtools(
          () =>
            mod.ReactQueryDevtools as unknown as ReactQueryDevtoolsComponent,
        );
      })
      .catch((error: unknown) => {
        console.warn("[query-devtools] unavailable in this dev session", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!Devtools) return null;

  return <Devtools initialIsOpen={false} buttonPosition="bottom-left" />;
}
