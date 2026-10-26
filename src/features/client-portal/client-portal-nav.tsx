"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { signOut } from "@/features/auth/actions";

const HEADER_BTN = "h-9 cursor-pointer px-3";

export function ClientPortalNav() {
  const t = useTranslations("pages.clientPortal");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const onEmployees = pathname === "/client-portal/employees" || pathname.startsWith("/client-portal/employees/");

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        className={HEADER_BTN}
        variant={onEmployees ? "outline" : "default"}
        style={onEmployees ? { borderColor: "#A73C24", color: "#A73C24" } : { background: "#A73C24", color: "#fff" }}
        onClick={() => router.push("/client-portal")}
      >
        {t("navDashboard")}
      </Button>
      <Button
        className={HEADER_BTN}
        variant={onEmployees ? "default" : "outline"}
        style={onEmployees ? { background: "#A73C24", color: "#fff" } : { borderColor: "#A73C24", color: "#A73C24" }}
        onClick={() => router.push("/client-portal/employees")}
      >
        {t("navEmployees")}
      </Button>
      <Button
        variant="outline"
        className={HEADER_BTN}
        style={{ borderColor: "#A73C24", color: "#A73C24" }}
        disabled={pending}
        onClick={() => {
          startTransition(() => {
            void signOut(locale);
          });
        }}
      >
        {t("signOut")}
      </Button>
    </div>
  );
}
