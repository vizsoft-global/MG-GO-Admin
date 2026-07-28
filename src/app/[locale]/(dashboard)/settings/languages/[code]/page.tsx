import { setRequestLocale } from "next-intl/server";
import { requireSuperAdmin } from "@/lib/auth/require-super-admin";
import { TranslationEditorPanel } from "@/features/languages/translation-editor-panel";

export default async function TranslationEditorPage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  await requireSuperAdmin(locale);

  return <TranslationEditorPanel localeCode={code} />;
}
