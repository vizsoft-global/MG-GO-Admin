"use client";

import { useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useBranding } from "@/contexts/branding-context";
import { DEFAULT_APP_SETTINGS, FONT_OPTIONS } from "@/lib/branding/constants";
import {
  resetBranding,
  updateBranding,
  uploadLogo,
} from "@/features/settings/branding-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppFormSection } from "@/components/app";
export function BrandingSettingsPanel() {
  const t = useTranslations("pages.settings.branding");
  const locale = useLocale();
  const router = useRouter();
  const branding = useBranding();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const logoPreview =
    preview ?? branding.logoUrl ?? DEFAULT_APP_SETTINGS.logo_url;

  const errorMessage =
    error === "missing_fields"
      ? t("errors.missingFields")
      : error === "invalid_font"
        ? t("errors.invalidFont")
        : error === "missing_file"
          ? t("errors.missingFile")
          : error === "file_too_large"
            ? t("errors.fileTooLarge")
            : error === "invalid_type"
              ? t("errors.invalidType")
              : error === "upload_failed" || error === "save_failed"
                ? t("errors.saveFailed")
                : error === "not_authorized"
                  ? t("errors.notAuthorized")
                  : null;

  return (
    <div className="space-y-6">
    <AppFormSection title={t("title")} description={t("subtitle")}>
      <div className="space-y-6">
        <form
          className="grid gap-4 sm:grid-cols-2"
          action={(formData) => {
            startTransition(async () => {
              setError(null);
              const result = await updateBranding(locale, formData);
              if (result.error) {
                setError(result.error);
                return;
              }
              router.refresh();
            });
          }}
        >
          <div className="space-y-2 sm:col-span-1">
            <Label htmlFor="appName">{t("appName")}</Label>
            <Input
              id="appName"
              name="appName"
              defaultValue={branding.appName}
              required
              disabled={isPending}
            />
          </div>
          <div className="space-y-2 sm:col-span-1">
            <Label htmlFor="appSubtitle">{t("appSubtitle")}</Label>
            <Input
              id="appSubtitle"
              name="appSubtitle"
              defaultValue={branding.appSubtitle}
              required
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">{t("appSubtitleDriverHint")}</p>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="driverAppLoginHint">{t("driverAppLoginHint")}</Label>
            <Input
              id="driverAppLoginHint"
              name="driverAppLoginHint"
              defaultValue={branding.driverAppLoginHint}
              required
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">{t("driverAppLoginHintHelp")}</p>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="fontFamily">{t("font")}</Label>
            <select
              id="fontFamily"
              name="fontFamily"
              defaultValue={branding.fontFamily}
              disabled={isPending}
              className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {FONT_OPTIONS.map((font) => (
                <option key={font.id} value={font.id}>
                  {font.label}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={isPending} className="cursor-pointer rounded-lg">
              {isPending ? t("saving") : t("save")}
            </Button>
          </div>
        </form>

        <div className="space-y-3 border-t border-border pt-6">
          <Label>{t("logo")}</Label>
          <p className="text-xs text-muted-foreground">{t("logoHint")}</p>
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoPreview}
              alt={branding.appName}
              className="h-14 w-14 rounded-lg border border-border object-contain bg-muted/30 p-1"
            />
            <Input
              ref={fileRef}
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
              disabled={isPending}
              className="max-w-sm cursor-pointer"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setPreview(URL.createObjectURL(file));
                }
              }}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            className="cursor-pointer rounded-lg"
            onClick={() => {
              const file = fileRef.current?.files?.[0];
              if (!file) {
                setError("missing_file");
                return;
              }
              startTransition(async () => {
                setError(null);
                const formData = new FormData();
                formData.append("logo", file);
                const result = await uploadLogo(locale, formData);
                if (result.error) {
                  setError(result.error);
                  return;
                }
                if (result.logoUrl) {
                  setPreview(result.logoUrl);
                }
                if (fileRef.current) fileRef.current.value = "";
                router.refresh();
              });
            }}
          >
            {t("uploadLogo")}
          </Button>
        </div>

        <div className="border-t border-border pt-4">
          <Button
            type="button"
            variant="ghost"
            disabled={isPending}
            className="cursor-pointer text-destructive hover:text-destructive"
            onClick={() => {
              startTransition(async () => {
                setError(null);
                const result = await resetBranding(locale);
                if (result.error) {
                  setError(result.error);
                  return;
                }
                setPreview(null);
                if (fileRef.current) fileRef.current.value = "";
                router.refresh();
              });
            }}
          >
            {t("reset")}
          </Button>
        </div>

        {errorMessage ? (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : null}
      </div>
    </AppFormSection>
    </div>
  );
}
