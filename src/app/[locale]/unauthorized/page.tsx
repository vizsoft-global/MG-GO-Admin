import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function UnauthorizedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pages.unauthorized");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <Logo size="lg" />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          <Button render={<Link href="/dashboard" />} className="cursor-pointer">
            {t("back")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
