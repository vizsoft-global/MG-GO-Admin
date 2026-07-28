"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { requestPasswordReset } from "@/features/auth/actions";
import { BrandMark } from "@/components/brand/brand-mark";
import { useBranding } from "@/contexts/branding-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const { appSubtitle } = useBranding();
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  const errorMessage =
    error === "missing_fields"
      ? t("missingFields")
      : error === "reset_failed"
        ? t("resetFailed")
        : null;

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6">
      <BrandMark size="lg" layout="stack" priority />
      <Card className="w-full border-border shadow-[0_4px_24px_rgba(15,15,15,0.08)]">
        <CardHeader className="space-y-1">
          <CardTitle className="text-xl">{t("forgotTitle")}</CardTitle>
          <CardDescription>{appSubtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          {success ? (
            <p className="text-sm text-muted-foreground">{t("resetEmailSent")}</p>
          ) : (
            <form
              className="space-y-4"
              action={(formData) => {
                startTransition(async () => {
                  setError(null);
                  const result = await requestPasswordReset(locale, formData);
                  if (result?.error) {
                    setError(result.error);
                    return;
                  }
                  setSuccess(true);
                });
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="email">{t("email")}</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  disabled={isPending}
                />
              </div>
              {errorMessage ? (
                <p className="text-sm text-destructive" role="alert">
                  {errorMessage}
                </p>
              ) : null}
              <Button type="submit" className="w-full cursor-pointer rounded-lg" disabled={isPending}>
                {isPending ? t("sendingReset") : t("sendResetLink")}
              </Button>
            </form>
          )}
          <p className="mt-4 text-center text-sm text-muted-foreground">
            <Link href={`/${locale}/login`} className="font-medium text-accent hover:underline">
              {t("backToSignIn")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
