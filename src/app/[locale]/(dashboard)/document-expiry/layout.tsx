import type { ReactNode } from "react";
import { requireNotPartner } from "@/lib/auth/require-permission";

/**
 * Partner guard for this area. A client login is sent back to its own portal
 * instead of rendering a page that was never scoped for it.
 */
export default async function PartnerAreaLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireNotPartner(locale);
  return children;
}