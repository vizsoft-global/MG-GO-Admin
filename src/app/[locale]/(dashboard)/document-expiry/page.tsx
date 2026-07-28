import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { DocumentExpiryPageShell } from "@/features/document-expiry/document-expiry-page-shell";

export default async function DocumentExpiryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "documents.view");

  return <DocumentExpiryPageShell />;
}
