import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { NewPortalV2 } from "@/features/portal-v2/new-portal-v2";
import { isPortalProjectKey } from "@/features/portal-v2/portal-config";
import { fetchPortalConfig } from "@/features/portal-v2/portal-config-actions";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function ClientPortalV2NewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ project?: string }>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const session = await requirePermission(locale, "client_portal.view");
  if (session.accessKind === "partner") {
    redirect({ href: "/client-portal-v2", locale });
  }
  const requested = typeof query.project === "string" ? query.project.trim().toLowerCase() : "";
  const project = isPortalProjectKey(requested) ? requested : "";
  const existing = project ? (await fetchPortalConfig({ projectKey: project })).row : null;
  return <NewPortalV2 initial={existing} initialProject={project || undefined} />;
}
