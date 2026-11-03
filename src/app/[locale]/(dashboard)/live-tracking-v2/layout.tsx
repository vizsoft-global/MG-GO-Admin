import type { ReactNode } from "react";
import { requireNotPartner } from "@/lib/auth/require-permission";

/**
 * The canvas owns its own height and must not be allowed to grow the dashboard's
 * scroll container — `min-h-0` is what keeps the map inside one viewport.
 * A partner login is sent to its own portal before the canvas mounts.
 */
export default async function LiveTrackingV2Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireNotPartner(locale);
  return <div className="min-h-0">{children}</div>;
}
