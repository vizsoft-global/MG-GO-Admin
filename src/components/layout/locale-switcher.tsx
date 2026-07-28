"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Languages } from "lucide-react";

const localeLabels: Record<Locale, string> = {
  en: "English",
  ar: "العربية",
};

export function LocaleSwitcher() {
  const t = useTranslations("common");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "cursor-pointer",
        )}
      >
        <Languages className="h-4 w-4" />
        <span className="sr-only">{t("language")}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {routing.locales.map((nextLocale) => (
          <DropdownMenuItem
            key={nextLocale}
            className="cursor-pointer"
            onClick={() => router.replace(pathname, { locale: nextLocale })}
          >
            {localeLabels[nextLocale]}
            {locale === nextLocale ? " ✓" : ""}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
