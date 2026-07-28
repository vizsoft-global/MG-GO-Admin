import { redirect } from "@/i18n/navigation";
import { setRequestLocale } from "next-intl/server";

export default async function DeliveriesZonesRedirectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  redirect({ href: "/zones", locale });
}
