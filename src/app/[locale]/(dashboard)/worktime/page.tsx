import { redirect } from "@/i18n/navigation";

export default async function WorktimeRedirectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/attendance?tab=history", locale });
}
