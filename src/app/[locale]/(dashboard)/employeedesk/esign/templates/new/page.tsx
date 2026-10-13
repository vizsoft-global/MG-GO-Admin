import { setRequestLocale } from "next-intl/server";
import { EsignSendShell } from "@/features/esign/esign-send-shell";
import { requireAnyPermission } from "@/lib/auth/require-permission";

/**
 * Figma "Create from template" (5873:14925).
 *
 * `?template=` is how the library's "Use for one employee" opens this screen
 * on a chosen document. A render still does not insert a template row.
 */
export default async function EmployeeDeskEsignNewTemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  const template = query.template;
  const draft = query.draft;
  const category = query.category;
  const driver = query.driver;
  const resentFrom = query.resentFrom;
  setRequestLocale(locale);
  await requireAnyPermission(locale, ["employeedesk.manage", "requests.manage"]);
  return (
    <EsignSendShell
      initialTemplateId={typeof template === "string" ? template : undefined}
      initialDraftId={typeof draft === "string" ? draft : undefined}
      initialCategoryKey={typeof category === "string" ? category : undefined}
      initialDriverId={typeof driver === "string" ? driver : undefined}
      initialResentFromId={typeof resentFrom === "string" ? resentFrom : undefined}
    />
  );
}
