"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import { BrandMark } from "@/components/brand/brand-mark";
import { useBranding } from "@/contexts/branding-context";
import { signInWithEmail } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function LoginForm() {
  const t = useTranslations("auth");
  const { appSubtitle } = useBranding();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const urlError = searchParams.get("error");
  const errorMessage =
    error === "invalid_credentials"
      ? t("invalidCredentials")
      : error === "not_authorized" || urlError === "not_authorized"
        ? t("notAuthorized")
        : urlError
          ? t("allowlistRequired")
          : null;

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6">
      <BrandMark size="lg" layout="stack" priority />
      <Card className="w-full border-border shadow-[0_4px_24px_rgba(15,15,15,0.08)]">
        <CardHeader className="space-y-1">
          <CardTitle className="text-xl">{t("signIn")}</CardTitle>
          <CardDescription>{appSubtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            action={(formData) => {
              startTransition(async () => {
                const result = await signInWithEmail(locale, formData);
                if (result?.error) {
                  setError(result.error);
                }
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
                className="rounded-lg"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t("password")}</Label>
                <Link
                  href={`/${locale}/forgot-password`}
                  className="text-xs font-medium text-accent hover:underline"
                >
                  {t("forgotPassword")}
                </Link>
              </div>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={isPending}
                className="rounded-lg"
              />
            </div>
            {errorMessage ? (
              <p className="text-sm text-destructive" role="alert">
                {errorMessage}
              </p>
            ) : null}
            <Button
              type="submit"
              className="w-full cursor-pointer rounded-lg"
              disabled={isPending}
            >
              {isPending ? t("signingIn") : t("signIn")}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {t("noAccount")}{" "}
            <Link href={`/${locale}/signup`} className="font-medium text-accent hover:underline">
              {t("signUp")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
