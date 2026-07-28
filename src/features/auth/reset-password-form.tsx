"use client";

import { useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { updatePassword } from "@/features/auth/actions";
import { BrandMark } from "@/components/brand/brand-mark";
import { useBranding } from "@/contexts/branding-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ResetPasswordForm() {
  const t = useTranslations("auth");
  const { appSubtitle } = useBranding();
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const errorMessage =
    error === "weak_password"
      ? t("weakPassword")
      : error === "update_failed"
        ? t("updatePasswordFailed")
        : null;

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6">
      <BrandMark size="lg" layout="stack" priority />
      <Card className="w-full border-border shadow-[0_4px_24px_rgba(15,15,15,0.08)]">
        <CardHeader className="space-y-1">
          <CardTitle className="text-xl">{t("resetTitle")}</CardTitle>
          <CardDescription>{appSubtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            action={(formData) => {
              startTransition(async () => {
                setError(null);
                const result = await updatePassword(formData);
                if (result?.error) {
                  setError(result.error);
                  return;
                }
                router.push(`/${locale}/login?reset=success`);
              });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="password">{t("newPassword")}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                disabled={isPending}
              />
            </div>
            {errorMessage ? (
              <p className="text-sm text-destructive" role="alert">
                {errorMessage}
              </p>
            ) : null}
            <Button type="submit" className="w-full cursor-pointer rounded-lg" disabled={isPending}>
              {isPending ? t("updatingPassword") : t("updatePassword")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
