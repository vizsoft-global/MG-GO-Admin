import { getTranslations, setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { Card, CardContent } from "@/components/ui/card";

export default async function VehicleDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "vehicles.view");
  const t = await getTranslations("pages.vehicleDetail");

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={`${t("subtitle")} · ${id.slice(0, 8)}…`}
      />
      <Card className="rounded-xl border-border shadow-sm">
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">{t("emptyTitle")}</p>
        </CardContent>
      </Card>
    </AppPage>
  );
}
