import type { ReactNode } from "react";

/**
 * The canvas owns its own height and must not be allowed to grow the dashboard's
 * scroll container — `min-h-0` is what keeps the map inside one viewport.
 */
export default function LiveTrackingV2Layout({ children }: { children: ReactNode }) {
  return <div className="min-h-0">{children}</div>;
}
