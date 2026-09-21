import { setRequestLocale } from "next-intl/server";
import { AssistantPageShell } from "@/features/assistant/assistant-page-shell";
import { isGatewayConfigured } from "@/features/assistant/assistant-contract";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function AssistantPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "assistant.view");

  return <AssistantPageShell gatewayReady={isGatewayConfigured()} />;
}
