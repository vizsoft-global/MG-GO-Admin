import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { BrandingProvider } from "@/contexts/branding-context";
import { getAppSettings } from "@/lib/branding/get-app-settings";
import { buildCustomThemeCss } from "@/lib/theme/presets";
import { siteConfig } from "@/config/site";
import { routing } from "@/i18n/routing";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/components/providers/query-provider";
import { VersionGuard } from "@/components/system/version-guard";
import { HtmlLocaleAttributes } from "@/components/system/html-locale-attributes";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/** Branding and theme come from DB; must not bake defaults at build time. */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getAppSettings();
  const icon = settings.logoUrl ?? siteConfig.logo;

  return {
    title: settings.appName,
    description: siteConfig.description,
    icons: {
      icon,
      apple: icon,
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as "en" | "ar")) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages();
  const branding = await getAppSettings();
  const customThemeCss = !branding.theme.isPreset
    ? buildCustomThemeCss(
        branding.theme.themeId,
        branding.theme.lightTokens,
        branding.theme.darkTokens,
      )
    : null;

  return (
    <>
      <HtmlLocaleAttributes
        locale={locale}
        themeId={branding.themeId}
        fontFamily={branding.fontFamily}
      />
      {customThemeCss ? (
        <style dangerouslySetInnerHTML={{ __html: customThemeCss }} />
      ) : null}
      <ThemeProvider>
        <BrandingProvider value={branding}>
          <NextIntlClientProvider messages={messages}>
            <QueryProvider>
              <TooltipProvider>
                {children}
                <VersionGuard />
                <Toaster richColors position="top-center" />
              </TooltipProvider>
            </QueryProvider>
          </NextIntlClientProvider>
        </BrandingProvider>
      </ThemeProvider>
    </>
  );
}
