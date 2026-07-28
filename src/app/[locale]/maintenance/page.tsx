import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { BrandMark } from "@/components/brand/brand-mark";
import { PendingSignOutButton } from "@/features/auth/pending-sign-out-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function MaintenancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth.maintenance");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <BrandMark size="lg" layout="stack" />
        <Card className="w-full text-center">
          <CardHeader>
            <CardTitle>{t("title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
            <PendingSignOutButton label={t("signOut")} locale={locale} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
