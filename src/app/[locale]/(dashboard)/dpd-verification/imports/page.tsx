import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { VerificationImportsPageShell } from "@/features/verifications/verification-imports-page-shell";

export default async function VerificationImportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "verifications.view");

  return <VerificationImportsPageShell />;
}
