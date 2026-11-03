import type { ReactNode } from "react";
import { requireNotPartner } from "@/lib/auth/require-permission";

/**
 * Secondary nav for settings sub-pages is handled by AppSecondaryNav in the dashboard layout.
 * A partner login is sent to its own portal instead of rendering settings.
 */
export default async function SettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireNotPartner(locale);
  return <>{children}</>;
}
