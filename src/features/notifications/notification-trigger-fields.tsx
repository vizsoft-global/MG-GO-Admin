"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { RequiredLabel } from "./notification-form-primitives";
import type { NotificationAutomationTrigger } from "./types";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export function defaultTriggerConfig(
  triggerType: NotificationAutomationTrigger,
): Record<string, unknown> {
  switch (triggerType) {
    case "inactivity":
      return { inactivity_days: 7 };
    case "document_expiry":
      return { days_before_expiry: 14 };
    case "shift_reminder":
      return { time: "08:00", weekdays: ["mon", "tue", "wed", "thu", "fri"] };
    case "schedule":
      return { cron: "0 8 * * *" };
    case "low_performance":
      return { min_deliveries: 5, period_days: 7 };
    case "missed_submission":
      return { hours_after_shift: 2 };
    default:
      return {};
  }
}

export function NotificationTriggerFields({
  triggerType,
  config,
  onChange,
}: {
  triggerType: NotificationAutomationTrigger;
  config: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const t = useTranslations("pages.notifications");

  function setField(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  switch (triggerType) {
    case "inactivity":
      return (
        <div className="space-y-1">
          <RequiredLabel required>{t("triggerInactivityDays")}</RequiredLabel>
          <Input
            className="h-9"
            type="number"
            min={1}
            value={String(config.inactivity_days ?? 7)}
            onChange={(e) => setField("inactivity_days", Number(e.target.value) || 1)}
          />
          <p className="text-xs text-muted-foreground">{t("triggerInactivityHint")}</p>
        </div>
      );
    case "document_expiry":
      return (
        <div className="space-y-1">
          <RequiredLabel required>{t("triggerDaysBeforeExpiry")}</RequiredLabel>
          <Input
            className="h-9"
            type="number"
            min={0}
            value={String(config.days_before_expiry ?? 14)}
            onChange={(e) => setField("days_before_expiry", Number(e.target.value) || 0)}
          />
          <p className="text-xs text-muted-foreground">{t("triggerDocumentExpiryHint")}</p>
        </div>
      );
    case "shift_reminder":
      return (
        <div className="space-y-3">
          <div className="space-y-1">
            <RequiredLabel required>{t("triggerShiftTime")}</RequiredLabel>
            <Input
              className="h-9"
              type="time"
              value={String(config.time ?? "08:00")}
              onChange={(e) => setField("time", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <RequiredLabel required>{t("triggerShiftWeekdays")}</RequiredLabel>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((day) => {
                const selected = ((config.weekdays as string[] | undefined) ?? []).includes(day);
                return (
                  <label key={day} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={selected}
                      onCheckedChange={(checked) => {
                        const current = (config.weekdays as string[] | undefined) ?? [];
                        setField(
                          "weekdays",
                          checked ? [...current, day] : current.filter((d) => d !== day),
                        );
                      }}
                    />
                    {t(`weekdays.${day}`)}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      );
    case "schedule":
      return (
        <div className="space-y-1">
          <RequiredLabel required>{t("triggerCron")}</RequiredLabel>
          <Input
            className="h-9 font-mono text-sm"
            value={String(config.cron ?? "0 8 * * *")}
            onChange={(e) => setField("cron", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t("triggerCronHint")}</p>
        </div>
      );
    case "low_performance":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <RequiredLabel required>{t("triggerMinDeliveries")}</RequiredLabel>
            <Input
              className="h-9"
              type="number"
              min={0}
              value={String(config.min_deliveries ?? 5)}
              onChange={(e) => setField("min_deliveries", Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1">
            <RequiredLabel required>{t("triggerPeriodDays")}</RequiredLabel>
            <Input
              className="h-9"
              type="number"
              min={1}
              value={String(config.period_days ?? 7)}
              onChange={(e) => setField("period_days", Number(e.target.value) || 1)}
            />
          </div>
        </div>
      );
    case "missed_submission":
      return (
        <div className="space-y-1">
          <RequiredLabel required>{t("triggerHoursAfterShift")}</RequiredLabel>
          <Input
            className="h-9"
            type="number"
            min={1}
            value={String(config.hours_after_shift ?? 2)}
            onChange={(e) => setField("hours_after_shift", Number(e.target.value) || 1)}
          />
        </div>
      );
    case "attendance_approved":
    case "salary_processed":
    case "incentive_unlocked":
      return (
        <p className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
          {t(`triggerEventHint.${triggerType}`)}
        </p>
      );
    default:
      return null;
  }
}
