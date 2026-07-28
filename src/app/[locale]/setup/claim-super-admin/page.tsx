"use client";

import { useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { claimSuperAdmin } from "@/features/auth/actions";
import { BrandMark } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ClaimSuperAdminPage() {
  const t = useTranslations("auth.claim");
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <BrandMark size="lg" layout="stack" />
        <Card className="w-full">
          <CardHeader>
            <CardTitle>{t("title")}</CardTitle>
            <CardDescription>{t("subtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="mb-6 text-sm text-muted-foreground">{t("body")}</p>
            <Button
              className="w-full cursor-pointer rounded-lg"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  await claimSuperAdmin(locale);
                });
              }}
            >
              {isPending ? t("claiming") : t("confirm")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
