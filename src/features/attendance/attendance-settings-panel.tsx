"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppFormSection, AppPage, AppPageHeader } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useAttendanceThresholdSettings,
  useUpdateAttendanceThresholdSettings,
} from "./use-attendance-table";

export function AttendanceSettingsPanel() {
  const t = useTranslations("pages.attendanceSettings");
  const { data, isLoading } = useAttendanceThresholdSettings();
  const { mutateAsync } = useUpdateAttendanceThresholdSettings();
  const [isPending, startTransition] = useTransition();

  const [lateGrace, setLateGrace] = useState("10");
  const [earlyOutGrace, setEarlyOutGrace] = useState("5");
  const [offlineAlert, setOfflineAlert] = useState("5");
  const [autoCheckout, setAutoCheckout] = useState("45");
  const [gpsStale, setGpsStale] = useState("10");
  const [gpsAccuracy, setGpsAccuracy] = useState("100");

  useEffect(() => {
    if (!data) return;
    setLateGrace(String(data.attendance_late_grace_minutes));
    setEarlyOutGrace(String(data.attendance_early_out_grace_minutes));
    setOfflineAlert(String(data.attendance_offline_alert_minutes));
    setAutoCheckout(String(data.attendance_auto_checkout_minutes));
    setGpsStale(String(data.attendance_gps_stale_minutes));
    setGpsAccuracy(String(data.attendance_gps_min_accuracy_meters));
  }, [data]);

  function handleSave() {
    startTransition(async () => {
      const result = await mutateAsync({
        attendance_late_grace_minutes: Number(lateGrace),
        attendance_early_out_grace_minutes: Number(earlyOutGrace),
        attendance_offline_alert_minutes: Number(offlineAlert),
        attendance_auto_checkout_minutes: Number(autoCheckout),
        attendance_gps_stale_minutes: Number(gpsStale),
        attendance_gps_min_accuracy_meters: Number(gpsAccuracy),
      });
      if (!result.success) {
        toast.error(result.error ?? t("saveFailed"));
        return;
      }
      toast.success(t("saved"));
    });
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <AppPage>
      <AppPageHeader title={t("title")} description={t("subtitle")} />
      <AppFormSection title={t("thresholdsTitle")} description={t("thresholdsHint")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="late-grace">{t("lateGrace")}</Label>
            <Input
              id="late-grace"
              type="number"
              min={0}
              value={lateGrace}
              onChange={(e) => setLateGrace(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="early-out">{t("earlyOutGrace")}</Label>
            <Input
              id="early-out"
              type="number"
              min={0}
              value={earlyOutGrace}
              onChange={(e) => setEarlyOutGrace(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="offline-alert">{t("offlineAlert")}</Label>
            <Input
              id="offline-alert"
              type="number"
              min={0}
              value={offlineAlert}
              onChange={(e) => setOfflineAlert(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="auto-checkout">{t("autoCheckout")}</Label>
            <Input
              id="auto-checkout"
              type="number"
              min={1}
              value={autoCheckout}
              onChange={(e) => setAutoCheckout(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">{t("autoCheckoutHint")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="gps-stale">{t("gpsStale")}</Label>
            <Input
              id="gps-stale"
              type="number"
              min={0}
              value={gpsStale}
              onChange={(e) => setGpsStale(e.target.value)}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="gps-accuracy">{t("gpsAccuracy")}</Label>
            <Input
              id="gps-accuracy"
              type="number"
              min={0}
              value={gpsAccuracy}
              onChange={(e) => setGpsAccuracy(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-6">
          <Button type="button" onClick={handleSave} disabled={isPending}>
            {isPending ? t("saving") : t("save")}
          </Button>
        </div>
      </AppFormSection>
    </AppPage>
  );
}
