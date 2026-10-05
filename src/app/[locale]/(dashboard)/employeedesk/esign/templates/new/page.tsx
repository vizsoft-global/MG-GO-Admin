import { setRequestLocale } from "next-intl/server";
import { TemplateBuilderShell } from "@/features/employeedesk/esign/template-builder-shell";
import { blankEsignTemplate } from "@/features/employeedesk/esign/blank-template";
import { fetchEsignCategories } from "@/features/esign/esign-actions";
import { requireAnyPermission } from "@/lib/auth/require-permission";

/**
 * Create mode.
 *
 * No row is written on this request — a page render is not a mutation, and an
 * abandoned "New template" would otherwise leave an empty draft in the catalog
 * every time an author changed their mind. The builder saves the template first
 * and then routes itself to the id the insert returned.
 */
export default async function EmployeeDeskEsignNewTemplatePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAnyPermission(locale, ["employeedesk.manage", "requests.manage"]);

  const categories = await fetchEsignCategories();

  return (
    <TemplateBuilderShell
      template={blankEsignTemplate()}
      categories={categories.rows}
      isNew
    />
  );
}
