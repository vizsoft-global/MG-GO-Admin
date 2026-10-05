import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { TemplateBuilderShell } from "@/features/employeedesk/esign/template-builder-shell";
import { fetchEsignCategories } from "@/features/esign/esign-actions";
import { fetchEsignTemplate } from "@/features/esign/esign-sender-actions";
import { requireAnyPermission } from "@/lib/auth/require-permission";

export default async function EmployeeDeskEsignTemplateBuilderPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireAnyPermission(locale, ["employeedesk.manage", "requests.manage"]);

  // Both reads are independent and the categories list is small, so they go out
  // together — one round trip of latency in front of the first paint.
  const [templateResult, categoriesResult] = await Promise.all([
    fetchEsignTemplate(id),
    fetchEsignCategories(),
  ]);

  if (!templateResult.template) notFound();

  return (
    <TemplateBuilderShell
      template={templateResult.template}
      categories={categoriesResult.rows}
    />
  );
}
