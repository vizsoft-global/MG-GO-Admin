import { setRequestLocale, getTranslations } from "next-intl/server";
import {
  BellRing,
  FileClock,
  FileSignature,
  Layers,
  PenLine,
  Send,
  SendHorizontal,
  Upload,
} from "lucide-react";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { requireAnyPermission } from "@/lib/auth/require-permission";

/**
 * EmployeeDesk → E-Signature hub.
 *
 * Every door onto the EmployeeDesk tree is listed here, which is the point: the
 * V2 routes (`templates`, `send`, `bulk`, `waiting`, `signing`) are twins of
 * their `/requests/esign` originals, and a twin nothing links to is a fork with
 * extra steps. Drafts, Sent and Batches stay on the V1 routes deliberately —
 * there is no V2 screen for them, so listing a second URL would be inventing one.
 */
const CARDS = [
  { key: "templates", href: "/employeedesk/esign/templates", icon: FileSignature },
  { key: "send", href: "/employeedesk/esign/send", icon: SendHorizontal },
  { key: "bulk", href: "/employeedesk/esign/bulk", icon: Upload },
  { key: "drafts", href: "/requests/esign/drafts", icon: FileClock },
  { key: "sent", href: "/requests/esign/sent", icon: Send },
  { key: "waiting", href: "/employeedesk/esign/waiting", icon: BellRing },
  { key: "signing", href: "/employeedesk/esign/signing", icon: PenLine },
  { key: "batches", href: "/requests/esign/batches", icon: Layers },
] as const;

export default async function EmployeeDeskEsignHubPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAnyPermission(locale, ["employeedesk.view", "requests.view"]);
  const t = await getTranslations("pages.employeedesk.esign.hub");

  return (
    <AppPage>
      <AppPageHeader
        breadcrumbs={[
          { label: t("breadcrumbHub"), href: "/employeedesk" },
          { label: t("breadcrumb") },
        ]}
        title={t("title")}
        description={t("subtitle")}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <Link key={card.key} href={card.href} className="group">
              <Card className="h-full rounded-xl border-border bg-card shadow-sm transition-colors group-hover:border-primary/40">
                <CardContent className="flex items-start gap-3 p-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {t(`cards.${card.key}.title`)}
                    </p>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                      {t(`cards.${card.key}.body`)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </AppPage>
  );
}
