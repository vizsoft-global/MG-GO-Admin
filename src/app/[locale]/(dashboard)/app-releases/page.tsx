import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { AppPage, AppPageHeader } from "@/components/app";

/**
 * App Releases (sideload APK OTA) was removed for Google Play policy.
 * Drivers update only via Play Store.
 */
export default async function AppReleasesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Keep page reachable if bookmarked / old menus; settings managers only.
  await requirePermission(locale, "settings.manage");

  return (
    <AppPage>
      <AppPageHeader
        title="App Releases removed"
        description="Direct APK push and in-app sideloading have been permanently removed so the driver app can publish on Google Play."
      />
      <div className="max-w-xl space-y-3 rounded-lg border border-border bg-muted/20 p-6 text-sm text-muted-foreground">
        <p>
          Build the driver app with <code className="text-foreground">./scripts/build_play.sh</code>{" "}
          and upload the AAB to the Play Console. Drivers must install and update only from Google
          Play.
        </p>
        <p className="font-medium text-foreground">
          The driver app also refuses to run when Android Developer options are enabled.
        </p>
      </div>
    </AppPage>
  );
}
