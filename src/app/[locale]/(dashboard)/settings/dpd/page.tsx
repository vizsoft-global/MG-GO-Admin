import { redirect } from "@/i18n/navigation";

export default async function LegacyDpdSettingsRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/delivery-rules", locale });
}
