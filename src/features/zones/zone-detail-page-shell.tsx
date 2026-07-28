"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Loader2, Pencil, Users } from "lucide-react";
import { AppPage } from "@/components/app/app-page";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { MetricTile, Pill } from "@/components/ui/metric-tile";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/contexts/auth-context";
import { formatZoneArea, zoneAreaSqKm } from "@/lib/geo/zone-area";
import { cn } from "@/lib/utils";
import { ZoneMapPanel } from "./zone-map-panel";
import { useZoneDrivers, useZonesList } from "./use-zones";

function DetailSkeleton() {
  return (
    <AppPage className="space-y-4 animate-pulse">
      <div className="h-8 w-32 rounded-md bg-muted" />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <div className="h-[420px] rounded-xl bg-muted" />
        <div className="space-y-3">
          <div className="h-24 rounded-xl bg-muted" />
          <div className="h-48 rounded-xl bg-muted" />
        </div>
      </div>
    </AppPage>
  );
}

function formatCreatedAt(value: string, locale: string) {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kuwait",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function ZoneDetailPageShell({ id }: { id: string }) {
  const locale = useLocale();
  const t = useTranslations("pages.zones");
  const { can } = useAuth();
  const canManage = can("zones.manage");

  const { data: zones = [], isLoading } = useZonesList();
  const zone = useMemo(() => zones.find((item) => item.id === id) ?? null, [id, zones]);
  const { data: drivers = [], isLoading: driversLoading } = useZoneDrivers(id, Boolean(zone));

  if (isLoading) {
    return <DetailSkeleton />;
  }

  if (!zone) {
    return (
      <AppPage>
        <Link
          href="/zones"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("backToList")}
        </Link>
        <AppEmptyState
          title={t("detailNotFoundTitle")}
          description={t("detailNotFoundDescription")}
        />
      </AppPage>
    );
  }

  const areaLabel = formatZoneArea(zoneAreaSqKm(zone.zone_type, zone.geometry));
  const typeTone = zone.geofence_kind === "inclusion" ? "success" : "danger";

  return (
    <AppPage className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Link
          href="/zones"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("backToList")}
        </Link>
        {canManage ? (
          <Link
            href={`/zones/${zone.id}/edit`}
            className="inline-flex h-9 cursor-pointer items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Pencil className="me-2 h-3.5 w-3.5" />
            {t("editZone")}
          </Link>
        ) : null}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-foreground">{zone.name}</h1>
            <p className="mt-0.5 font-mono text-sm text-muted-foreground">{zone.code}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Pill tone={typeTone}>{t(`geofence.kind.${zone.geofence_kind}`)}</Pill>
            <Pill tone={zone.status === "active" ? "success" : "neutral"}>
              {t(`geofence.status.${zone.status}`)}
            </Pill>
          </div>
        </div>
        {zone.description ? (
          <p className="mt-3 text-sm text-muted-foreground">{zone.description}</p>
        ) : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <ZoneMapPanel
          zones={[zone]}
          selectedId={zone.id}
          className="min-h-[420px] lg:min-h-[520px]"
        />

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <MetricTile
              label={t("geofence.colDrivers")}
              value={zone.driver_count.toLocaleString()}
              tone="primary"
              icon={Users}
            />
            <MetricTile
              label={t("geofence.colArea")}
              value={areaLabel}
              tone="primary"
            />
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">{t("detailOverviewTitle")}</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t("fieldType")}</dt>
                <dd className="font-medium">
                  {zone.zone_type === "circle" ? t("typeCircle") : t("typePolygon")}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t("geofence.colCreated")}</dt>
                <dd className="font-medium">{formatCreatedAt(zone.created_at, locale)}</dd>
              </div>
              {zone.driver_group_label ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{t("geofence.driverGroupLabel")}</dt>
                  <dd className="font-medium">{zone.driver_group_label}</dd>
                </div>
              ) : null}
            </dl>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">{t("detailAlertsTitle")}</h2>
            <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              <li>
                {zone.alert_on_entry
                  ? t("detailAlertEnabled", { label: t("geofence.alertEntry") })
                  : t("detailAlertDisabled", { label: t("geofence.alertEntry") })}
              </li>
              <li>
                {zone.alert_on_exit
                  ? t("detailAlertEnabled", { label: t("geofence.alertExit") })
                  : t("detailAlertDisabled", { label: t("geofence.alertExit") })}
              </li>
              <li>
                {zone.alert_on_dwell
                  ? t("detailAlertDwellOn", { seconds: zone.dwell_time_seconds })
                  : t("detailAlertDwellOff")}
              </li>
            </ul>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">{t("detailDriversTitle")}</h2>
              <span className="text-xs tabular-nums text-muted-foreground">
                {zone.driver_count}
              </span>
            </div>
            {driversLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : drivers.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noDrivers")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("detailDriverName")}</TableHead>
                    <TableHead className={cn("text-end", TABLE_HEAD_CLASS)}>
                      {t("detailDriverCode")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drivers.map((driver) => (
                    <TableRow key={driver.id}>
                      <TableCell className="text-sm">
                        {driver.full_name ?? t("unknownDriver")}
                      </TableCell>
                      <TableCell className="text-end font-mono text-sm tabular-nums">
                        #{driver.driver_code}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </div>
    </AppPage>
  );
}
