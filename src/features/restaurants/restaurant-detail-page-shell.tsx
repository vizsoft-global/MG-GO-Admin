"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  MapPin,
  Pencil,
  RefreshCw,
  Users,
} from "lucide-react";
import { AppPage } from "@/components/app/app-page";
import { AppEmptyState } from "@/components/app/app-empty-state";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { TabBar } from "@/components/dashboard/tab-bar";
import { StatusPill } from "@/components/dashboard/status-pill";
import { MetricTile } from "@/components/ui/metric-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { useAuth } from "@/contexts/auth-context";
import {
  canManageRestaurants,
  hasPermissionInSet,
} from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import { DeliveryDetailSheet } from "@/features/deliveries/delivery-detail-sheet";
import { DeliveryLocationMap } from "@/features/deliveries/delivery-location-map";
import { formatRelativeMinutesAgo } from "@/features/deliveries/delivery-sort-utils";
import type { DeliveryListRow, DeliveryStatus } from "@/features/deliveries/types";
import { AttendancePill } from "@/features/drivers/driver-list-ui";
import {
  useRestaurantActivityLog,
  useRestaurantAssignedDrivers,
  useRestaurantDeliveries,
  useRestaurantDetail,
} from "./use-restaurants";
import { resolveDeliveryStatusVariant } from "@/features/deliveries/delivery-status-variant";
import type { RestaurantActivityKind } from "./types";

type DetailTabId = "overview" | "drivers" | "deliveries" | "activity";

type DeliveriesTabFilter = "all" | "active" | DeliveryStatus;

function DetailSkeleton() {
  return (
    <AppPage className="space-y-4 animate-pulse">
      <div className="h-8 w-32 rounded-md bg-muted" />
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex gap-4">
          <div className="h-16 w-16 shrink-0 rounded-xl bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-6 w-48 rounded-md bg-muted" />
            <div className="h-4 w-32 rounded-md bg-muted" />
          </div>
        </div>
      </div>
    </AppPage>
  );
}

function formatDateTime(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kuwait",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatDayHeading(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: "Asia/Kuwait",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function RestaurantDetailPageShell({ id }: { id: string }) {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("pages.restaurants");
  const tDeliveries = useTranslations("pages.deliveries");
  const { permissions, isSuperAdmin } = useAuth();
  const canManage = canManageRestaurants(new Set(permissions), isSuperAdmin);
  const canViewDeliveries = hasPermissionInSet(
    new Set(permissions),
    "deliveries.view",
    isSuperAdmin,
  );

  const [tab, setTab] = useState<DetailTabId>("overview");
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveriesTabFilter>("all");
  const [selectedDelivery, setSelectedDelivery] = useState<DeliveryListRow | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const detailQuery = useRestaurantDetail(id);
  const driversQuery = useRestaurantAssignedDrivers(id);
  const deliveriesQuery = useRestaurantDeliveries(
    id,
    deliveryFilter === "all"
      ? {}
      : deliveryFilter === "active"
        ? { status: "active" }
        : { status: deliveryFilter },
    canViewDeliveries && tab === "deliveries",
  );
  const activityQuery = useRestaurantActivityLog(
    id,
    canViewDeliveries && tab === "activity",
  );

  const restaurant = detailQuery.data;

  const tabs = useMemo(
    () => [
      { id: "overview", label: t("tabs.overview") },
      { id: "drivers", label: t("tabs.drivers") },
      { id: "deliveries", label: t("tabs.deliveries") },
      { id: "activity", label: t("tabs.activity") },
    ],
    [t],
  );

  const deliveryTableColumns = useMemo(
    () => [
      { id: "order", label: tDeliveries("colOrderId"), className: "min-w-[140px]" },
      { id: "driver", label: tDeliveries("colDriver"), className: "min-w-[160px]" },
      { id: "status", label: tDeliveries("colStatus"), className: "w-[140px]" },
      { id: "when", label: tDeliveries("colWhen"), className: "min-w-[160px]" },
    ],
    [tDeliveries],
  );

  const formatWhenColumn = (delivery: DeliveryListRow): string => {
    if (delivery.status === "in_transit" && delivery.pickup_at) {
      const mins = formatRelativeMinutesAgo(delivery.pickup_at);
      return tDeliveries("pickedUpAgo", { minutes: mins });
    }
    if (delivery.status === "cancelled" && delivery.cancelled_at) {
      return formatDateTime(delivery.cancelled_at, locale);
    }
    if (delivery.delivered_at) {
      return formatDateTime(delivery.delivered_at, locale);
    }
    if (delivery.pickup_at) {
      return formatDateTime(delivery.pickup_at, locale);
    }
    return formatDateTime(delivery.created_at, locale);
  };

  const deliveryStatusLabel = (status: DeliveryStatus) => {
    switch (status) {
      case "verified":
        return tDeliveries("statusVerified");
      case "rejected":
        return tDeliveries("statusRejected");
      case "under_review":
        return tDeliveries("statusUnderReview");
      case "in_transit":
        return tDeliveries("statusInTransit");
      case "cancelled":
        return tDeliveries("statusCancelled");
      default:
        return tDeliveries("statusPending");
    }
  };

  const activityKindLabel = (kind: RestaurantActivityKind) => {
    switch (kind) {
      case "pickup":
        return t("activity.pickup");
      case "in_transit":
        return t("activity.inTransit");
      case "delivered":
        return t("activity.delivered");
      case "cancelled":
        return t("activity.cancelled");
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        detailQuery.refetch(),
        driversQuery.refetch(),
        canViewDeliveries ? deliveriesQuery.refetch() : Promise.resolve(),
        canViewDeliveries ? activityQuery.refetch() : Promise.resolve(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const activityByDay = useMemo(() => {
    const groups = new Map<string, typeof activityQuery.data>();
    for (const event of activityQuery.data ?? []) {
      const day = formatDayHeading(event.at, locale);
      const list = groups.get(day) ?? [];
      list.push(event);
      groups.set(day, list);
    }
    return [...groups.entries()];
  }, [activityQuery.data, locale]);

  if (detailQuery.isLoading) return <DetailSkeleton />;

  if (detailQuery.isError || !restaurant) {
    return (
      <AppPage>
        <Link
          href="/restaurants"
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

  const stats = restaurant.delivery_stats;
  const mapPoints =
    restaurant.has_coordinates &&
    restaurant.latitude != null &&
    restaurant.longitude != null
      ? [
          {
            lat: restaurant.latitude,
            lng: restaurant.longitude,
            kind: "pickup" as const,
            label: restaurant.name,
          },
        ]
      : [];

  const statusBadgeLabel = () => {
    switch (restaurant.status) {
      case "published":
        return t("statusPublished");
      case "archived":
        return t("statusArchived");
      default:
        return t("statusDraft");
    }
  };

  return (
    <AppPage className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-3">
          <Link
            href="/restaurants"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("backToList")}
          </Link>
          <div className="flex items-start gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40">
              {restaurant.logo_display_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={restaurant.logo_display_url}
                  alt=""
                  className="h-full w-full object-contain p-1"
                />
              ) : (
                <span className="text-xs font-medium text-muted-foreground">
                  {restaurant.name.slice(0, 2).toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-foreground">
                {restaurant.name}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    restaurant.status === "published"
                      ? "default"
                      : restaurant.status === "archived"
                        ? "outline"
                        : "secondary"
                  }
                  className="rounded-lg"
                >
                  {statusBadgeLabel()}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {restaurant.partner_name}
                </span>
                {restaurant.zone_name !== "—" ? (
                  <span className="text-sm text-muted-foreground">
                    · {restaurant.zone_name}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {restaurant.external_merchant_id
                  ? `${t("colExternalId")}: ${restaurant.external_merchant_id}`
                  : null}
                {restaurant.external_merchant_id ? " · " : null}
                {t("colCreated")}: {formatDateTime(restaurant.created_at, locale)}
              </p>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 cursor-pointer rounded-lg"
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
          >
            <RefreshCw
              className={cn("me-2 h-3.5 w-3.5", isRefreshing && "animate-spin")}
            />
            {t("refresh")}
          </Button>
          {canManage ? (
            <Button
              type="button"
              size="sm"
              className="h-9 cursor-pointer rounded-lg"
              onClick={() => router.push(`/restaurants/${id}/edit`)}
            >
              <Pencil className="me-2 h-3.5 w-3.5" />
              {t("editRestaurant")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricTile
          label={t("kpiAssignedDrivers")}
          value={String(restaurant.driver_count)}
          icon={Users}
        />
        <MetricTile
          label={t("kpiActiveDeliveries")}
          value={String(stats.active_deliveries)}
        />
        <MetricTile
          label={t("kpiTotalDeliveries")}
          value={String(stats.deliveries_total)}
        />
        <MetricTile
          label={t("kpiVerifiedDeliveries")}
          value={String(stats.deliveries_verified)}
        />
        <MetricTile
          label={t("kpiCancelledDeliveries")}
          value={String(stats.cancelled_today)}
          hint={t("kpiCancelledTodayHint")}
        />
      </div>

      <TabBar
        items={tabs}
        activeId={tab}
        onSelect={(id) => setTab(id as DetailTabId)}
      />

      {tab === "overview" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4 rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-medium text-foreground">{t("overviewTitle")}</h2>
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">{t("colPartner")}</dt>
                <dd className="font-medium">{restaurant.partner_name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("colZone")}</dt>
                <dd className="font-medium">{restaurant.zone_name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("fields.location")}</dt>
                <dd className="font-medium">
                  {restaurant.has_coordinates
                    ? t("filterHasLocationYes")
                    : t("filterHasLocationNo")}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("overviewGeofences")}</dt>
                <dd className="font-medium">
                  {t("geofenceCount", { count: restaurant.geofence_count })}
                </dd>
              </div>
              {restaurant.map_link ? (
                <div>
                  <dt className="text-muted-foreground">{t("fields.mapLink")}</dt>
                  <dd>
                    <a
                      href={restaurant.map_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      {t("openMapLink")}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
          {mapPoints.length > 0 ? (
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                <MapPin className="h-4 w-4" />
                {t("overviewMapTitle")}
              </h2>
              <DeliveryLocationMap points={mapPoints} mapHeightClass="h-[240px]" />
              {restaurant.latitude != null && restaurant.longitude != null ? (
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  {restaurant.latitude.toFixed(6)}, {restaurant.longitude.toFixed(6)}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-8">
              <AppEmptyState
                title={t("overviewNoLocationTitle")}
                description={t("overviewNoLocationDescription")}
              />
            </div>
          )}
        </div>
      ) : null}

      {tab === "drivers" ? (
        <div className="rounded-xl border border-border bg-card">
          {driversQuery.isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (driversQuery.data ?? []).length === 0 ? (
            <div className="p-8">
              <AppEmptyState
                title={t("driversEmptyTitle")}
                description={t("driversEmptyDescription")}
              />
            </div>
          ) : (
            <table className="w-full caption-bottom text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className={TABLE_HEAD_CLASS}>{t("driverColName")}</th>
                  <th className={TABLE_HEAD_CLASS}>{t("driverColCode")}</th>
                  <th className={TABLE_HEAD_CLASS}>{t("driverColPhone")}</th>
                  <th className={TABLE_HEAD_CLASS}>{t("driverColLink")}</th>
                  <th className={TABLE_HEAD_CLASS}>{t("driverColDuty")}</th>
                </tr>
              </thead>
              <tbody>
                {(driversQuery.data ?? []).map((driver) => {
                  const detailHref = driver.intake_id
                    ? `/drivers/${driver.intake_id}`
                    : driver.driver_id
                      ? `/drivers/${driver.driver_id}`
                      : null;
                  return (
                  <tr
                    key={driver.id}
                    className={cn(
                      "border-b border-border hover:bg-muted/40",
                      detailHref && "cursor-pointer",
                    )}
                    onClick={() => {
                      if (detailHref) {
                        router.push(detailHref);
                      }
                    }}
                  >
                    <td className="p-3 font-medium">{driver.name}</td>
                    <td className="p-3 font-mono text-xs text-muted-foreground">
                      {driver.driver_code}
                    </td>
                    <td className="p-3 text-muted-foreground">{driver.phone ?? "—"}</td>
                    <td className="p-3">
                      <Badge
                        variant={driver.link_status === "linked" ? "default" : "secondary"}
                        className="rounded-lg"
                      >
                        {driver.link_status === "linked"
                          ? t("driverLinkLinked")
                          : t("driverLinkIntake")}
                      </Badge>
                    </td>
                    <td className="p-3">
                      {driver.link_status === "linked" ? (
                        <AttendancePill
                          onDuty={driver.is_on_duty}
                          onDutyLabel={t("driverOnDuty")}
                          offDutyLabel={t("driverOffDuty")}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {tab === "deliveries" ? (
        !canViewDeliveries ? (
          <AppEmptyState
            title={t("deliveriesNoAccessTitle")}
            description={t("deliveriesNoAccessDescription")}
          />
        ) : (
          <div className="space-y-3">
            <TabBar
              items={[
                { id: "all", label: tDeliveries("tabAll") },
                { id: "active", label: tDeliveries("tabActive") },
                { id: "pending", label: tDeliveries("statusPending") },
                { id: "verified", label: tDeliveries("statusVerified") },
                { id: "cancelled", label: tDeliveries("statusCancelled") },
              ]}
              activeId={deliveryFilter}
              onSelect={(id) => setDeliveryFilter(id as DeliveriesTabFilter)}
            />
            <div className="rounded-xl border border-border bg-card">
              {deliveriesQuery.isLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (deliveriesQuery.data ?? []).length === 0 ? (
                <div className="p-8">
                  <AppEmptyState
                    title={t("deliveriesEmptyTitle")}
                    description={t("deliveriesEmptyDescription")}
                  />
                </div>
              ) : (
                <AppDataTable columns={deliveryTableColumns}>
                  {(deliveriesQuery.data ?? []).map((row) => (
                    <AppDataTableRow
                      key={row.id}
                      onClick={() => setSelectedDelivery(row)}
                    >
                      <TableCell className="whitespace-normal align-top">
                        <p className="font-mono text-xs tabular-nums">{row.short_id}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.external_order_id ?? "—"}
                        </p>
                      </TableCell>
                      <TableCell className="whitespace-normal align-top">
                        <p className="font-medium">{row.driver_name}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {row.driver_code}
                        </p>
                      </TableCell>
                      <TableCell className="align-top">
                        <StatusPill variant={resolveDeliveryStatusVariant(row.status)}>
                          {deliveryStatusLabel(row.status)}
                        </StatusPill>
                      </TableCell>
                      <TableCell className="whitespace-normal align-top text-sm text-muted-foreground">
                        {formatWhenColumn(row)}
                      </TableCell>
                    </AppDataTableRow>
                  ))}
                </AppDataTable>
              )}
            </div>
          </div>
        )
      ) : null}

      {tab === "activity" ? (
        !canViewDeliveries ? (
          <AppEmptyState
            title={t("deliveriesNoAccessTitle")}
            description={t("deliveriesNoAccessDescription")}
          />
        ) : activityQuery.isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : activityByDay.length === 0 ? (
          <AppEmptyState
            title={t("activityEmptyTitle")}
            description={t("activityEmptyDescription")}
          />
        ) : (
          <div className="space-y-6">
            {activityByDay.map(([day, events]) => (
              <div key={day}>
                <h3 className="mb-3 text-sm font-medium text-muted-foreground">{day}</h3>
                <ul className="space-y-2">
                  {events?.map((event) => (
                    <li
                      key={`${event.delivery_id}-${event.kind}-${event.at}`}
                      className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {activityKindLabel(event.kind)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {event.driver_name} · {event.driver_code} ·{" "}
                          {event.external_order_id ?? event.short_id}
                        </p>
                        {event.cancel_reason ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {event.cancel_reason}
                          </p>
                        ) : null}
                      </div>
                      <time className="text-xs tabular-nums text-muted-foreground">
                        {formatDateTime(event.at, locale)}
                      </time>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )
      ) : null}

      <DeliveryDetailSheet
        delivery={selectedDelivery}
        open={Boolean(selectedDelivery)}
        onClose={() => setSelectedDelivery(null)}
      />
    </AppPage>
  );
}
