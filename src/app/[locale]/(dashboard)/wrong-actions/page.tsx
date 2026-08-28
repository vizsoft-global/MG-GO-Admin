import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { WrongActionsPageShell } from "@/features/wrong-actions/wrong-actions-page-shell";

export default async function WrongActionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ add?: string; tab?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "wrong_actions.view");
  const { add, tab } = await searchParams;

  return <WrongActionsPageShell addOpen={add === "1"} tab={tab} />;
}
