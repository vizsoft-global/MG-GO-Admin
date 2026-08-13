import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { EsignSignaturesShell } from "@/features/esign/esign-signatures-shell";

export default async function EsignSignaturesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.manage");
  return <EsignSignaturesShell />;
}
