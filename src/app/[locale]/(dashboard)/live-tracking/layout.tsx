import type { ReactNode } from "react";
import { requireNotPartner } from "@/lib/auth/require-permission";

export default async function LiveTrackingLayout({
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
