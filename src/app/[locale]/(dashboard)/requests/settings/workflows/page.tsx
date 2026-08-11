import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { WorkflowsSettingsPanel } from "@/features/requests/workflows-settings-panel";

export default async function RequestsWorkflowsSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.manage");

  return <WorkflowsSettingsPanel />;
}
