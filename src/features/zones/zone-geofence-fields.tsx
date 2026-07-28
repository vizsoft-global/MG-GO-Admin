"use client";

import { useTranslations } from "next-intl";
import { Ban, CheckCircle2, Circle as CircleIcon, Hexagon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchSelect } from "@/components/ui/search-select";
import { cn } from "@/lib/utils";
import type {
  GeofenceKind,
  GeofenceStatus,
  ZoneGeofenceSettings,
} from "./types";
import type { ZoneGeometryType } from "@/lib/geo/zone-geometry";

type GeofenceFieldsProps = {
  value: ZoneGeofenceSettings;
  onChange: (next: ZoneGeofenceSettings) => void;
};

export function ZoneGeofenceTypeSection({ value, onChange }: GeofenceFieldsProps) {
  const t = useTranslations("pages.zones");
  const items: Array<{ kind: GeofenceKind; Icon: typeof CheckCircle2 }> = [
    { kind: "inclusion", Icon: CheckCircle2 },
    { kind: "exclusion", Icon: Ban },
  ];

  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold text-foreground">
        {t("geofence.kindTitle")}
      </Label>
      <div className="grid grid-cols-2 gap-2">
        {items.map(({ kind, Icon }) => {
          const active = value.geofence_kind === kind;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onChange({ ...value, geofence_kind: kind })}
              className={cn(
                "group flex cursor-pointer flex-col items-start gap-1.5 rounded-lg border p-3 text-start transition-colors",
                active
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:border-primary/40 hover:bg-muted/40",
              )}
              aria-pressed={active}
            >
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-md",
                  active
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground group-hover:text-primary",
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span
                className={cn(
                  "text-sm font-semibold",
                  active ? "text-foreground" : "text-foreground",
                )}
              >
                {t(`geofence.kind.${kind}`)}
              </span>
              <span className="text-[11px] leading-tight text-muted-foreground">
                {t(`geofence.kindHint.${kind}`)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ZoneGeofenceShapeSection({
  value,
  onChange,
  onShapeRequest,
}: {
  value: ZoneGeometryType;
  onChange: (next: ZoneGeometryType) => void;
  onShapeRequest?: (next: ZoneGeometryType) => void;
}) {
  const t = useTranslations("pages.zones");
  const items: Array<{ shape: ZoneGeometryType; Icon: typeof Hexagon }> = [
    { shape: "polygon", Icon: Hexagon },
    { shape: "circle", Icon: CircleIcon },
  ];

  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold text-foreground">
        {t("geofence.shapeTitle")}
      </Label>
      <div className="grid grid-cols-2 gap-2">
        {items.map(({ shape, Icon }) => {
          const active = value === shape;
          return (
            <button
              key={shape}
              type="button"
              onClick={() => {
                onChange(shape);
                onShapeRequest?.(shape);
              }}
              className={cn(
                "group flex cursor-pointer flex-col items-start gap-1.5 rounded-lg border p-3 text-start transition-colors",
                active
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:border-primary/40 hover:bg-muted/40",
              )}
              aria-pressed={active}
            >
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-md",
                  active
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground group-hover:text-primary",
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-sm font-semibold text-foreground">
                {t(`geofence.shape.${shape}`)}
              </span>
              <span className="text-[11px] leading-tight text-muted-foreground">
                {t(`geofence.shapeHint.${shape}`)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ZoneGeofenceStatusSection({ value, onChange }: GeofenceFieldsProps) {
  const t = useTranslations("pages.zones");
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-foreground">
        {t("geofence.statusTitle")}
      </Label>
      <div className="flex flex-wrap gap-1.5">
        {(["active", "inactive", "draft"] as GeofenceStatus[]).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => onChange({ ...value, status })}
            className={cn(
              "cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              value.status === status
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:bg-muted/50",
            )}
            aria-pressed={value.status === status}
          >
            {t(`geofence.status.${status}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

function formatMmSs(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function parseMmSs(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return 0;
  const match = trimmed.match(/^(\d{1,3}):([0-5]?\d)$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (Number.isNaN(minutes) || Number.isNaN(seconds)) return null;
  return Math.max(0, minutes * 60 + seconds);
}

export function ZoneAlertSettingsSection({ value, onChange }: GeofenceFieldsProps) {
  const t = useTranslations("pages.zones");

  const alerts = [
    { key: "alert_on_entry" as const, label: t("geofence.alertEntry") },
    { key: "alert_on_exit" as const, label: t("geofence.alertExit") },
    { key: "alert_on_dwell" as const, label: t("geofence.alertDwell") },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-xs font-semibold text-foreground">
          {t("geofence.alertsTitle")}
        </Label>
      </div>
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {t("geofence.alertOnLabel")}
        </span>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {alerts.map(({ key, label }) => (
            <label
              key={key}
              htmlFor={key}
              className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
            >
              <Checkbox
                id={key}
                checked={value[key]}
                onCheckedChange={(checked) =>
                  onChange({ ...value, [key]: Boolean(checked) })
                }
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dwell-time-input" className="text-xs font-medium text-muted-foreground">
          {t("geofence.dwellTimeOptional")}
        </Label>
        <Input
          id="dwell-time-input"
          inputMode="numeric"
          pattern="\\d{1,3}:[0-5]\\d"
          placeholder="00:05"
          value={formatMmSs(value.dwell_time_seconds)}
          onChange={(event) => {
            const next = parseMmSs(event.target.value);
            if (next == null) return;
            onChange({ ...value, dwell_time_seconds: next });
          }}
          disabled={!value.alert_on_dwell}
          aria-describedby="dwell-time-help"
          className="h-9 rounded-lg font-mono text-sm tracking-wider"
        />
        <p id="dwell-time-help" className="text-[11px] text-muted-foreground">
          {t("geofence.dwellTimeHint")}
        </p>
      </div>
    </div>
  );
}

export function ZoneNotificationSettingsSection({
  value,
  onChange,
}: GeofenceFieldsProps) {
  const t = useTranslations("pages.zones");
  const items = [
    { key: "notify_in_app" as const, label: t("geofence.notifyInApp") },
    { key: "notify_email" as const, label: t("geofence.notifyEmail") },
    { key: "notify_sms" as const, label: t("geofence.notifySms") },
  ];

  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold text-foreground">
        {t("geofence.notificationsTitle")}
      </Label>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {items.map(({ key, label }) => (
          <label
            key={key}
            htmlFor={key}
            className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
          >
            <Checkbox
              id={key}
              checked={value[key]}
              onCheckedChange={(checked) =>
                onChange({ ...value, [key]: Boolean(checked) })
              }
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function ZoneAssignSettingsSection({
  value,
  onChange,
  groupItems,
}: GeofenceFieldsProps & {
  groupItems?: Array<{ value: string; label: string; keywords?: string[] }>;
}) {
  const t = useTranslations("pages.zones");
  const mode = value.assign_to_all_drivers ? "all" : "specific";

  return (
    <div className="space-y-2">
      <Label
        htmlFor="zone-assign-mode"
        className="text-xs font-semibold text-foreground"
      >
        {t("geofence.assignToOptional")}
      </Label>
      <Select
        value={mode}
        onValueChange={(next) =>
          onChange({
            ...value,
            assign_to_all_drivers: next === "all",
            driver_group_label:
              next === "all" ? null : value.driver_group_label,
          })
        }
      >
        <SelectTrigger id="zone-assign-mode" className="h-9 rounded-lg">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("geofence.assignAllDrivers")}</SelectItem>
          <SelectItem value="specific">{t("geofence.assignSpecific")}</SelectItem>
        </SelectContent>
      </Select>
      {mode === "specific" ? (
        <div className="space-y-1.5">
          <Label
            htmlFor="zone-driver-group"
            className="text-xs font-medium text-muted-foreground"
          >
            {t("geofence.driverGroupLabel")}
          </Label>
          {groupItems && groupItems.length > 0 ? (
            <SearchSelect
              items={groupItems}
              value={value.driver_group_label}
              onChange={(next) =>
                onChange({
                  ...value,
                  driver_group_label: next,
                })
              }
              recentsKey="zones-driver-group"
              searchPlaceholder={t("geofence.searchDriverHint")}
              placeholder={t("geofence.driverGroupPlaceholder")}
              className="h-9 rounded-lg"
            />
          ) : (
            <Input
              id="zone-driver-group"
              value={value.driver_group_label ?? ""}
              onChange={(event) =>
                onChange({ ...value, driver_group_label: event.target.value })
              }
              placeholder={t("geofence.driverGroupPlaceholder")}
              className="h-9 rounded-lg text-sm"
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

