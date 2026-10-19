import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { OrderExceptionsPageShell } from "@/features/order-exceptions/order-exceptions-page-shell";

export default async function OrderExceptionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "deliveries.view");
  return <OrderExceptionsPageShell />;
}
