import type { ReactNode } from "react";

export default function LiveTrackingLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-0">{children}</div>;
}
