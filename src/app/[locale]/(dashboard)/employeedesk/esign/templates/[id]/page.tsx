import { setRequestLocale } from "next-intl/server";
import { EsignSendShell } from "@/features/esign/esign-send-shell";
import { requireAnyPermission } from "@/lib/auth/require-permission";

/**
 * Figma "Create from template" — the same send screen as `/employeedesk/esign/send`,
 * opened on the template the library row named.
 */
export default async function EmployeeDeskEsignTemplateSendPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  const query = await searchParams;
  const draft = query.draft;
  const driver = query.driver;
  setRequestLocale(locale);
  await requireAnyPermission(locale, ["employeedesk.manage", "requests.manage"]);
  return (
    <EsignSendShell
      initialTemplateId={id}
      initialDraftId={typeof draft === "string" ? draft : undefined}
      initialDriverId={typeof driver === "string" ? driver : undefined}
    />
  );
}
