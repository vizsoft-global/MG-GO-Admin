import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { EsignSentShell } from "@/features/esign/esign-sent-shell";

export default async function EsignSentPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.manage");
  return <EsignSentShell />;
}
