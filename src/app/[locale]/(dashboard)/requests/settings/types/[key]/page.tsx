import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { RequestTypeDetailShell } from "@/features/requests/request-type-detail-shell";

export default async function RequestTypeDetailPage({
  params,
}: {
  params: Promise<{ locale: string; key: string }>;
}) {
  const { locale, key } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.manage");

  return <RequestTypeDetailShell typeKey={key} />;
}
