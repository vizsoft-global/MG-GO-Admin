"use client";

import { Bell, CalendarDays } from "lucide-react";
import { useTranslations } from "next-intl";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_NOTIFY_LEAD_DAYS,
  type DocumentExpiryConfig,
  EMPTY_DOCUMENT_EXPIRY,
} from "@/features/drivers/types";

const LEAD_DAY_OPTIONS = [...DEFAULT_NOTIFY_LEAD_DAYS];

export function mergeDocumentExpiry(
  base?: DocumentExpiryConfig | null,
): DocumentExpiryConfig {
  if (!base) return { ...EMPTY_DOCUMENT_EXPIRY };
  return {
    trackExpiry: base.trackExpiry,
    expiresAt: base.expiresAt,
    notifyEnabled: base.notifyEnabled,
    notifyLeadDays:
      base.notifyLeadDays.length > 0 ? base.notifyLeadDays : [...DEFAULT_NOTIFY_LEAD_DAYS],
    objectKey: base.objectKey,
  };
}

export function DocumentExpiryFields({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: DocumentExpiryConfig;
  onChange: (next: DocumentExpiryConfig) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations("pages.driverNew.documentExpiry");

  const toggleLeadDay = (day: number) => {
    const selected = value.notifyLeadDays.includes(day);
    const nextDays = selected
      ? value.notifyLeadDays.filter((d) => d !== day)
      : [...value.notifyLeadDays, day].sort((a, b) => b - a);
    onChange({
      ...value,
      notifyLeadDays: nextDays.length > 0 ? nextDays : [day],
    });
  };

  return (
    <div className={compact ? "mt-1.5 space-y-1.5 border-t border-border/60 pt-1.5" : "mt-2 space-y-2 border-t border-border/60 pt-2"}>
      <ToggleChip
        selected={value.trackExpiry}
        disabled={disabled}
        icon={CalendarDays}
        onClick={() =>
          onChange({
            ...value,
            trackExpiry: !value.trackExpiry,
            expiresAt: !value.trackExpiry ? value.expiresAt : null,
          })
        }
      >
        {t("trackExpiry")}
      </ToggleChip>

      {value.trackExpiry ? (
        <>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground">
              {t("expiresOn")} <span className="text-destructive">*</span>
            </label>
            <Input
              type="date"
              className="h-9"
              value={value.expiresAt ?? ""}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...value, expiresAt: event.target.value || null })
              }
            />
          </div>

          <div className="space-y-1">
            <p className="text-[10px] font-medium text-muted-foreground">{t("notifyBefore")}</p>
            <div className="flex flex-wrap gap-1">
              {LEAD_DAY_OPTIONS.map((day) => (
                <ToggleChip
                  key={day}
                  selected={value.notifyLeadDays.includes(day)}
                  disabled={disabled}
                  onClick={() => toggleLeadDay(day)}
                >
                  {t("leadDays", { days: day })}
                </ToggleChip>
              ))}
            </div>
          </div>

          <ToggleChip
            selected={value.notifyEnabled}
            disabled={disabled}
            icon={Bell}
            onClick={() => onChange({ ...value, notifyEnabled: !value.notifyEnabled })}
          >
            {t("notifyDriver")}
          </ToggleChip>
        </>
      ) : null}
    </div>
  );
}

export function appendExpiryToFormData(
  formData: FormData,
  docType: string,
  expiry: DocumentExpiryConfig,
): void {
  formData.append(`trackExpiry_${docType}`, expiry.trackExpiry ? "true" : "false");
  if (expiry.expiresAt) formData.append(`expiresAt_${docType}`, expiry.expiresAt);
  formData.append(`notifyEnabled_${docType}`, expiry.notifyEnabled ? "true" : "false");
  formData.append(`notifyLeadDays_${docType}`, expiry.notifyLeadDays.join(","));
}
