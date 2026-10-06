import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { EsignSendShell } from "@/features/esign/esign-send-shell";

export default async function EsignSendPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    draft?: string;
    template?: string;
    category?: string;
    driver?: string;
    resentFrom?: string;
  }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.manage");
  const { draft, template, category, driver, resentFrom } = await searchParams;
  return (
    <EsignSendShell
      initialDraftId={draft}
      initialTemplateId={template}
      initialCategoryKey={category}
      initialDriverId={driver}
      initialResentFromId={resentFrom}
    />
  );
}
