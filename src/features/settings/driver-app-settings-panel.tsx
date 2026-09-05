"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { BellRing, ExternalLink, Smartphone } from "lucide-react";
import { toast } from "sonner";
import {
  type DriverAppInstallStats,
  notifyOutdatedInstalls,
  resetDriverAppSettings,
  setDriverAppLoginVerificationExemptAll,
  setDriverAppMaintenanceMode,
  updateDriverAppDeliveryProximity,
  updateDriverAppForceUpdate,
  updateDriverAppMaintenanceMessage,
  updateDriverAppSettings,
  uploadDriverAppIcon,
  uploadDriverAppLogo,
  uploadDriverAppSplash,
} from "@/features/settings/driver-app-settings-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { AppFormSection } from "@/components/app";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Link } from "@/i18n/navigation";
import {
  MAX_DELIVERY_PROXIMITY_METERS,
  MIN_DELIVERY_PROXIMITY_METERS,
  DEFAULT_DRIVER_APP_SETTINGS,
} from "@/lib/branding/constants";
import { cn } from "@/lib/utils";

type DriverAppSettingsPanelProps = {
  driverAppTitle: string;
  driverAppLogoUrl: string | null;
  driverAppSplashUrl: string | null;
  driverAppIconUrl: string | null;
  driverAppMaintenanceMode: boolean;
  driverAppMaintenanceMessage: string;
  driverAppLoginVerificationExemptAll: boolean;
  driverAppDeliveryProximityMeters: number;
  driverAppForceUpdate: boolean;
  driverAppMinVersionCode: number | null;
  driverAppMinVersionName: string | null;
  driverAppUpdateMessage: string | null;
  installStats: DriverAppInstallStats;
};

const PLAY_LISTING_URL =
  "https://play.google.com/store/apps/details?id=com.musallam_delivery.app";

function AssetUploadBlock({
  label,
  hint,
  previewUrl,
  placeholder,
  fileRef,
  accept,
  uploadLabel,
  disabled,
  previewClassName,
  onFileChange,
  onUpload,
}: {
  label: string;
  hint: string;
  previewUrl: string | null;
  placeholder: string;
  fileRef: React.RefObject<HTMLInputElement | null>;
  accept: string;
  uploadLabel: string;
  disabled: boolean;
  previewClassName: string;
  onFileChange: (file: File) => void;
  onUpload: () => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="space-y-3 rounded-lg border border-border bg-muted/10 p-3">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt=""
            className={cn("rounded-lg border border-border bg-muted/30", previewClassName)}
          />
        ) : (
          <div
            className={cn(
              "flex items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 text-xs text-muted-foreground",
              previewClassName,
            )}
          >
            {placeholder}
          </div>
        )}
        <Input
          ref={fileRef}
          type="file"
          accept={accept}
          disabled={disabled}
          className="cursor-pointer"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFileChange(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className="w-fit cursor-pointer rounded-lg"
          onClick={onUpload}
        >
          {uploadLabel}
        </Button>
      </div>
    </div>
  );
}

export function DriverAppSettingsPanel({
  driverAppTitle,
  driverAppLogoUrl,
  driverAppSplashUrl,
  driverAppIconUrl,
  driverAppMaintenanceMode,
  driverAppMaintenanceMessage,
  driverAppLoginVerificationExemptAll,
  driverAppDeliveryProximityMeters,
  driverAppForceUpdate,
  driverAppMinVersionCode,
  driverAppMinVersionName,
  driverAppUpdateMessage,
  installStats,
}: DriverAppSettingsPanelProps) {
  const t = useTranslations("pages.settings.driverApp");
  const locale = useLocale();
  const router = useRouter();
  const logoRef = useRef<HTMLInputElement>(null);
  const splashRef = useRef<HTMLInputElement>(null);
  const iconRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [splashPreview, setSplashPreview] = useState<string | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [maintenanceMode, setMaintenanceMode] = useState(driverAppMaintenanceMode);
  const [loginVerificationExemptAll, setLoginVerificationExemptAll] = useState(
    driverAppLoginVerificationExemptAll,
  );
  const [proximityMeters, setProximityMeters] = useState(
    String(driverAppDeliveryProximityMeters),
  );
  const [forceUpdate, setForceUpdate] = useState(driverAppForceUpdate);
  const [minVersionCode, setMinVersionCode] = useState(
    driverAppMinVersionCode == null ? "" : String(driverAppMinVersionCode),
  );
  const [minVersionName, setMinVersionName] = useState(driverAppMinVersionName ?? "");
  const [updateMessage, setUpdateMessage] = useState(driverAppUpdateMessage ?? "");
  const [isPending, startTransition] = useTransition();

  const forceUpdateArmed = forceUpdate && minVersionCode.trim() !== "";

  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyTitle, setNotifyTitle] = useState("");
  const [notifyBody, setNotifyBody] = useState("");
  const [notifyPending, startNotify] = useTransition();

  // Installs the typed minimum would lock out. Unknown builds count as outdated,
  // mirroring the gate: a phone that cannot report its versionCode is refused.
  const parsedMinCode = Number(minVersionCode.trim());
  const thresholdCode =
    minVersionCode.trim() !== "" && Number.isFinite(parsedMinCode) && parsedMinCode > 0
      ? Math.trunc(parsedMinCode)
      : null;
  const outdatedInstalls = useMemo(() => {
    if (thresholdCode == null) return null;
    return installStats.versions
      .filter((v) => v.versionCode == null || v.versionCode < thresholdCode)
      .reduce((sum, v) => sum + v.installs, 0);
  }, [installStats.versions, thresholdCode]);

  const openNotify = () => {
    setNotifyTitle(t("notifyOutdatedDefaultTitle"));
    setNotifyBody(
      updateMessage.trim() ||
        t("notifyOutdatedDefaultBody", { version: minVersionName.trim() || minVersionCode.trim() }),
    );
    setNotifyOpen(true);
  };

  const submitNotify = () => {
    if (thresholdCode == null) return;
    startNotify(async () => {
      const result = await notifyOutdatedInstalls({
        belowVersionCode: thresholdCode,
        title: notifyTitle,
        body: notifyBody,
      });
      if ("error" in result) {
        toast.error(
          result.error === "no_outdated_installs"
            ? t("errors.noOutdatedInstalls")
            : result.error === "notifications_send_required"
              ? t("errors.notificationsSendRequired")
              : result.error === "missing_fields"
                ? t("errors.missingFields")
                : t("errors.notifyFailed"),
          { description: result.errorDetail },
        );
        return;
      }
      setNotifyOpen(false);
      toast.success(
        t("notifyOutdatedSent", { pushed: result.pushed, recipients: result.recipients }),
        {
          description:
            result.skipped > 0 || result.failed > 0
              ? t("notifyOutdatedSentDetail", { skipped: result.skipped, failed: result.failed })
              : undefined,
        },
      );
    });
  };

  const saveForceUpdate = (enabled: boolean) => {
    const trimmedCode = minVersionCode.trim();
    const parsedCode = trimmedCode === "" ? null : Number(trimmedCode);
    startTransition(async () => {
      setError(null);
      const result = await updateDriverAppForceUpdate(locale, {
        enabled,
        minVersionCode: parsedCode,
        minVersionName: minVersionName.trim() || null,
        message: updateMessage.trim() || null,
      });
      if (result.error) {
        setError(result.error);
        toast.error(
          result.error === "version_code_required"
            ? t("errors.versionCodeRequired")
            : result.error === "invalid_version_code"
              ? t("errors.invalidVersionCode")
              : t("errors.saveFailed"),
          { description: result.errorDetail },
        );
        return;
      }
      setForceUpdate(enabled);
      toast.success(
        enabled ? t("forceUpdateEnabled", { code: trimmedCode }) : t("forceUpdateSaved"),
      );
      router.refresh();
    });
  };

  const logoDisplay = logoPreview ?? driverAppLogoUrl;
  const splashDisplay = splashPreview ?? driverAppSplashUrl;
  const iconDisplay = iconPreview ?? driverAppIconUrl;

  const errorMessage =
    error === "missing_fields"
      ? t("errors.missingFields")
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
                : error === "invalid_proximity"
                  ? t("errors.invalidProximity")
                  : error === "version_code_required"
                    ? t("errors.versionCodeRequired")
                    : error === "invalid_version_code"
                      ? t("errors.invalidVersionCode")
                      : error === "invalid_version_name" || error === "invalid_message"
                        ? t("errors.saveFailed")
                        : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {/* Left column — branding & launch assets */}
        <AppFormSection title={t("brandingTitle")} description={t("brandingSubtitle")}>
            <form
              className="space-y-5"
              action={(formData) => {
                startTransition(async () => {
                  setError(null);
                  const result = await updateDriverAppSettings(locale, formData);
                  if (result.error) {
                    setError(result.error);
                    toast.error(t("errors.saveFailed"), {
                      description: result.errorDetail,
                      duration: result.errorDetail ? 12000 : 5000,
                    });
                    return;
                  }
                  toast.success(t("saved"));
                  router.refresh();
                });
              }}
            >
              <input
                type="hidden"
                name="driverAppMaintenanceMessage"
                value={driverAppMaintenanceMessage}
              />
              <div className="space-y-2">
                <Label htmlFor="driverAppTitle">{t("appTitle")}</Label>
                <Input
                  id="driverAppTitle"
                  name="driverAppTitle"
                  defaultValue={driverAppTitle}
                  required
                  disabled={isPending}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <AssetUploadBlock
                  label={t("logo")}
                  hint={t("logoHint")}
                  previewUrl={logoDisplay}
                  placeholder={t("noImage")}
                  fileRef={logoRef}
                  accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
                  uploadLabel={t("uploadLogo")}
                  disabled={isPending}
                  previewClassName="h-16 w-16 object-contain p-1"
                  onFileChange={(file) => setLogoPreview(URL.createObjectURL(file))}
                  onUpload={() => {
                    const file = logoRef.current?.files?.[0];
                    if (!file) {
                      setError("missing_file");
                      return;
                    }
                    startTransition(async () => {
                      setError(null);
                      const formData = new FormData();
                      formData.append("logo", file);
                      const result = await uploadDriverAppLogo(locale, formData);
                      if (result.error) {
                        setError(result.error);
                        toast.error(t("errors.saveFailed"), {
                          description: result.errorDetail,
                          duration: result.errorDetail ? 12000 : 5000,
                        });
                        return;
                      }
                      if (result.logoUrl) setLogoPreview(result.logoUrl);
                      if (logoRef.current) logoRef.current.value = "";
                      toast.success(t("logoUploaded"));
                      router.refresh();
                    });
                  }}
                />
                <AssetUploadBlock
                  label={t("splash")}
                  hint={t("splashHint")}
                  previewUrl={splashDisplay}
                  placeholder={t("noImage")}
                  fileRef={splashRef}
                  accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                  uploadLabel={t("uploadSplash")}
                  disabled={isPending}
                  previewClassName="mx-auto h-28 w-16 object-cover"
                  onFileChange={(file) => setSplashPreview(URL.createObjectURL(file))}
                  onUpload={() => {
                    const file = splashRef.current?.files?.[0];
                    if (!file) {
                      setError("missing_file");
                      return;
                    }
                    startTransition(async () => {
                      setError(null);
                      const formData = new FormData();
                      formData.append("splash", file);
                      const result = await uploadDriverAppSplash(locale, formData);
                      if (result.error) {
                        setError(result.error);
                        toast.error(t("errors.saveFailed"), {
                          description: result.errorDetail,
                          duration: result.errorDetail ? 12000 : 5000,
                        });
                        return;
                      }
                      if (result.splashUrl) setSplashPreview(result.splashUrl);
                      if (splashRef.current) splashRef.current.value = "";
                      toast.success(t("splashUploaded"));
                      router.refresh();
                    });
                  }}
                />
                <AssetUploadBlock
                  label={t("appIcon")}
                  hint={t("appIconHint")}
                  previewUrl={iconDisplay}
                  placeholder={t("noImage")}
                  fileRef={iconRef}
                  accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                  uploadLabel={t("uploadAppIcon")}
                  disabled={isPending}
                  previewClassName="h-16 w-16 object-cover"
                  onFileChange={(file) => setIconPreview(URL.createObjectURL(file))}
                  onUpload={() => {
                    const file = iconRef.current?.files?.[0];
                    if (!file) {
                      setError("missing_file");
                      return;
                    }
                    startTransition(async () => {
                      setError(null);
                      const formData = new FormData();
                      formData.append("icon", file);
                      const result = await uploadDriverAppIcon(locale, formData);
                      if (result.error) {
                        setError(result.error);
                        toast.error(t("errors.saveFailed"), {
                          description: result.errorDetail,
                          duration: result.errorDetail ? 12000 : 5000,
                        });
                        return;
                      }
                      if (result.iconUrl) setIconPreview(result.iconUrl);
                      if (iconRef.current) iconRef.current.value = "";
                      toast.success(t("appIconUploaded"));
                      router.refresh();
                    });
                  }}
                />
              </div>

              <div className="flex justify-end border-t border-border pt-4">
                <Button type="submit" disabled={isPending} className="cursor-pointer rounded-lg">
                  {isPending ? t("saving") : t("save")}
                </Button>
              </div>
            </form>
        </AppFormSection>

        {/* Right column — runtime rules & availability */}
        <div className="space-y-4">
          <AppFormSection
            title={t("deliveryProximityTitle")}
            description={t("deliveryProximitySubtitle")}
          >
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  const parsed = Number(proximityMeters);
                  startTransition(async () => {
                    setError(null);
                    const result = await updateDriverAppDeliveryProximity(locale, parsed);
                    if (result.error) {
                      setError(result.error);
                      toast.error(
                        result.error === "invalid_proximity"
                          ? t("errors.invalidProximity")
                          : t("errors.saveFailed"),
                      );
                      return;
                    }
                    toast.success(t("deliveryProximitySaved"));
                    router.refresh();
                  });
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="driverAppDeliveryProximity">{t("deliveryProximityLabel")}</Label>
                  <p className="text-xs text-muted-foreground">{t("deliveryProximityHint")}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      id="driverAppDeliveryProximity"
                      type="number"
                      min={MIN_DELIVERY_PROXIMITY_METERS}
                      max={MAX_DELIVERY_PROXIMITY_METERS}
                      step={1}
                      value={proximityMeters}
                      onChange={(e) => setProximityMeters(e.target.value)}
                      disabled={isPending}
                      className="w-40 tabular-nums"
                      required
                    />
                    <span className="text-sm text-muted-foreground">
                      {t("deliveryProximityUnit")}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("deliveryProximityDisabledHint")}
                  </p>
                </div>
                <div className="flex justify-end border-t border-border pt-4">
                  <Button type="submit" disabled={isPending} className="cursor-pointer rounded-lg">
                    {isPending ? t("saving") : t("saveDeliveryProximity")}
                  </Button>
                </div>
              </form>
          </AppFormSection>

          <AppFormSection
            title={t("loginVerificationExemptTitle")}
            description={t("loginVerificationExemptSubtitle")}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/10 p-3">
              <div className="space-y-1">
                <span
                  className={cn(
                    "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                    loginVerificationExemptAll
                      ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {loginVerificationExemptAll
                    ? t("loginVerificationExemptOn")
                    : t("loginVerificationExemptOff")}
                </span>
                <p className="text-xs text-muted-foreground">
                  {loginVerificationExemptAll
                    ? t("loginVerificationExemptOnHint")
                    : t("loginVerificationExemptOffHint")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="driverAppLoginVerificationExemptAll" className="text-sm">
                  {t("loginVerificationExemptToggle")}
                </Label>
                <Switch
                  id="driverAppLoginVerificationExemptAll"
                  checked={loginVerificationExemptAll}
                  disabled={isPending}
                  onCheckedChange={(checked) => {
                    startTransition(async () => {
                      setError(null);
                      const result =
                        await setDriverAppLoginVerificationExemptAll(checked);
                      if (result.error) {
                        toast.error(t("errors.saveFailed"));
                        return;
                      }
                      setLoginVerificationExemptAll(checked);
                      toast.success(
                        checked
                          ? t("loginVerificationExemptEnabled")
                          : t("loginVerificationExemptDisabled"),
                      );
                      router.refresh();
                    });
                  }}
                />
              </div>
            </div>
          </AppFormSection>

          <AppFormSection title={t("maintenanceTitle")} description={t("maintenanceSubtitle")}>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/10 p-3">
                <div className="space-y-1">
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                      maintenanceMode
                        ? "bg-destructive/15 text-destructive"
                        : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
                    )}
                  >
                    {maintenanceMode ? t("statusMaintenance") : t("statusLive")}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {maintenanceMode ? t("maintenanceOnHint") : t("maintenanceOffHint")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="driverAppMaintenance" className="text-sm">
                    {t("maintenanceToggle")}
                  </Label>
                  <Switch
                    id="driverAppMaintenance"
                    checked={maintenanceMode}
                    disabled={isPending}
                    onCheckedChange={(checked) => {
                      startTransition(async () => {
                        setError(null);
                        const result = await setDriverAppMaintenanceMode(checked);
                        if (result.error) {
                          toast.error(t("errors.saveFailed"));
                          return;
                        }
                        setMaintenanceMode(checked);
                        toast.success(
                          checked ? t("maintenanceEnabled") : t("maintenanceDisabled"),
                        );
                        router.refresh();
                      });
                    }}
                  />
                </div>
              </div>

              <form
                className="space-y-3"
                action={(formData) => {
                  startTransition(async () => {
                    setError(null);
                    const message = String(formData.get("driverAppMaintenanceMessage") ?? "");
                    const result = await updateDriverAppMaintenanceMessage(locale, message);
                    if (result.error) {
                      setError(result.error);
                      toast.error(t("errors.saveFailed"));
                      return;
                    }
                    toast.success(t("messageSaved"));
                    router.refresh();
                  });
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="driverAppMaintenanceMessage">{t("maintenanceMessage")}</Label>
                  <Textarea
                    id="driverAppMaintenanceMessage"
                    name="driverAppMaintenanceMessage"
                    defaultValue={driverAppMaintenanceMessage}
                    required
                    disabled={isPending}
                    rows={3}
                    className="min-h-[72px] resize-none"
                  />
                </div>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={isPending}
                  className="cursor-pointer rounded-lg"
                >
                  {isPending ? t("saving") : t("saveMessage")}
                </Button>
              </form>
            </div>
          </AppFormSection>

          <AppFormSection title={t("forceUpdateTitle")} description={t("forceUpdateSubtitle")}>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/10 p-3">
                <div className="space-y-1">
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                      forceUpdateArmed
                        ? "bg-destructive/15 text-destructive"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {forceUpdateArmed
                      ? t("forceUpdateOn", { code: minVersionCode.trim() })
                      : t("forceUpdateOff")}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {forceUpdateArmed ? t("forceUpdateOnHint") : t("forceUpdateOffHint")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="driverAppForceUpdate" className="text-sm">
                    {t("forceUpdateToggle")}
                  </Label>
                  <Switch
                    id="driverAppForceUpdate"
                    checked={forceUpdate}
                    disabled={isPending}
                    onCheckedChange={(checked) => saveForceUpdate(checked)}
                  />
                </div>
              </div>

              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveForceUpdate(forceUpdate);
                }}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="driverAppMinVersionCode">
                      {t("forceUpdateMinVersionCode")}
                      {forceUpdate ? <span className="text-destructive"> *</span> : null}
                    </Label>
                    <Input
                      id="driverAppMinVersionCode"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={minVersionCode}
                      onChange={(e) => setMinVersionCode(e.target.value)}
                      disabled={isPending}
                      placeholder="83"
                      className="tabular-nums"
                      required={forceUpdate}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      {t("forceUpdateMinVersionCodeHint")}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="driverAppMinVersionName">
                      {t("forceUpdateMinVersionName")}
                    </Label>
                    <Input
                      id="driverAppMinVersionName"
                      value={minVersionName}
                      onChange={(e) => setMinVersionName(e.target.value)}
                      disabled={isPending}
                      placeholder="1.1.21"
                      maxLength={32}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      {t("forceUpdateMinVersionNameHint")}
                    </p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="driverAppUpdateMessage">{t("forceUpdateMessage")}</Label>
                  <Textarea
                    id="driverAppUpdateMessage"
                    value={updateMessage}
                    onChange={(e) => setUpdateMessage(e.target.value)}
                    disabled={isPending}
                    rows={2}
                    maxLength={500}
                    placeholder={t("forceUpdateMessagePlaceholder")}
                    className="min-h-[56px] resize-none"
                  />
                </div>
                <div className="rounded-lg border border-border bg-muted/10 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Smartphone className="size-4 text-muted-foreground" aria-hidden />
                      <span className="font-medium">
                        {installStats.loadFailed
                          ? t("installsUnavailable")
                          : t("installsTotal", { count: installStats.total })}
                      </span>
                      {thresholdCode != null && outdatedInstalls != null ? (
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
                            outdatedInstalls > 0
                              ? "bg-amber-100 text-amber-800"
                              : "bg-emerald-100 text-emerald-800",
                          )}
                        >
                          {t("installsOutdated", { count: outdatedInstalls, code: thresholdCode })}
                        </span>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 cursor-pointer rounded-lg"
                      disabled={
                        isPending ||
                        installStats.loadFailed ||
                        thresholdCode == null ||
                        !outdatedInstalls
                      }
                      onClick={openNotify}
                    >
                      <BellRing className="size-4" aria-hidden />
                      {t("notifyOutdated")}
                    </Button>
                  </div>
                  {installStats.versions.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {installStats.versions.map((v) => {
                        const outdated =
                          thresholdCode != null &&
                          (v.versionCode == null || v.versionCode < thresholdCode);
                        const chip = (
                            <span
                            title={
                              v.versionName
                                ? `${v.versionName} · ${t("installsRecent", { count: v.recent })}`
                                : t("installsRecent", { count: v.recent })
                            }
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] tabular-nums",
                              outdated
                                ? "border-amber-200 bg-amber-50 text-amber-800"
                                : "border-border bg-card text-muted-foreground",
                            )}
                          >
                            <span className="font-medium">
                              {v.versionCode == null ? t("installsUnknownBuild") : `#${v.versionCode}`}
                            </span>
                            <span>×{v.installs}</span>
                          </span>
                        );
                        return v.versionCode == null ? (
                          <span key="unknown">{chip}</span>
                        ) : (
                          <Link
                            key={v.versionCode}
                            href={`/driver-devices?build=${v.versionCode}`}
                            className="hover:opacity-90"
                          >
                            {chip}
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                  <p className="mt-2 text-[10px] text-muted-foreground">{t("installsHint")}</p>
                  <Link
                    href="/driver-devices"
                    className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:bg-primary/10"
                  >
                    {t("openDriverDevices")}
                    <ExternalLink className="size-3" aria-hidden />
                  </Link>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <a
                    href={PLAY_LISTING_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary underline-offset-2 hover:underline"
                  >
                    {t("forceUpdatePlayLink")}
                  </a>
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={isPending}
                    className="cursor-pointer rounded-lg"
                  >
                    {isPending ? t("saving") : t("saveForceUpdate")}
                  </Button>
                </div>
              </form>
            </div>
          </AppFormSection>

          <Dialog open={notifyOpen} onOpenChange={setNotifyOpen}>
            <DialogContent
              showCloseButton
              closeOutside
              className="w-[min(560px,96vw)] overflow-visible px-5 py-4"
            >
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitNotify();
                }}
              >
                <div className="space-y-3 pt-1">
                  <div className="space-y-1.5">
                    <Label htmlFor="notifyOutdatedTitle">
                      {t("notifyOutdatedTitleLabel")}
                      <span className="text-destructive"> *</span>
                    </Label>
                    <Input
                      id="notifyOutdatedTitle"
                      value={notifyTitle}
                      onChange={(e) => setNotifyTitle(e.target.value)}
                      maxLength={120}
                      required
                      disabled={notifyPending}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="notifyOutdatedBody">
                      {t("notifyOutdatedBodyLabel")}
                      <span className="text-destructive"> *</span>
                    </Label>
                    <Textarea
                      id="notifyOutdatedBody"
                      value={notifyBody}
                      onChange={(e) => setNotifyBody(e.target.value)}
                      rows={3}
                      maxLength={500}
                      required
                      disabled={notifyPending}
                      className="min-h-[72px] resize-none"
                    />
                    <p className="text-[10px] text-muted-foreground">{t("notifyOutdatedBodyHint")}</p>
                  </div>
                </div>
                <AppModalFooter
                  title={t("notifyOutdated")}
                  subtitle={
                    thresholdCode != null && outdatedInstalls != null
                      ? t("notifyOutdatedSubtitle", { count: outdatedInstalls, code: thresholdCode })
                      : ""
                  }
                >
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9"
                    disabled={notifyPending}
                    onClick={() => setNotifyOpen(false)}
                  >
                    {t("cancel")}
                  </Button>
                  <Button type="submit" className="h-9" disabled={notifyPending}>
                    {notifyPending ? t("sending") : t("notifyOutdatedConfirm")}
                  </Button>
                </AppModalFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-2">
        <Button
          type="button"
          variant="ghost"
          disabled={isPending}
          className="cursor-pointer text-destructive hover:text-destructive"
          onClick={() => {
            if (!window.confirm(t("resetConfirm"))) return;
            startTransition(async () => {
              setError(null);
              const result = await resetDriverAppSettings(locale);
              if (result.error) {
                setError(result.error);
                toast.error(t("errors.saveFailed"));
                return;
              }
              setLogoPreview(null);
              setSplashPreview(null);
              setIconPreview(null);
              setMaintenanceMode(false);
              setForceUpdate(false);
              setMinVersionCode("");
              setMinVersionName("");
              setUpdateMessage("");
              setProximityMeters(
                String(DEFAULT_DRIVER_APP_SETTINGS.driver_app_delivery_proximity_meters),
              );
              if (logoRef.current) logoRef.current.value = "";
              if (splashRef.current) splashRef.current.value = "";
              if (iconRef.current) iconRef.current.value = "";
              toast.success(t("resetDone"));
              router.refresh();
            });
          }}
        >
          {t("reset")}
        </Button>

        {errorMessage ? (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}
