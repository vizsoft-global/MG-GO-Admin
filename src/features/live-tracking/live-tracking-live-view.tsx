"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { DriverLocationsMap } from "@/features/locations/driver-locations-map";
import { useDriverLocationsRealtime } from "@/features/locations/use-driver-locations-realtime";
import { isGpsLive } from "@/features/locations/location-status";
import { fetchDriversForAdmin } from "@/features/drivers/drivers-actions";
import { fetchRecentDeliveriesForDriver } from "@/features/deliveries/deliveries-actions";
import { fetchDriverAssignedRestaurantPins } from "@/features/locations/locations-actions";
import { fetchZones } from "@/features/zones/use-zones";
import { normalizeZoneColor } from "@/features/zones/zone-colors";
import { queryKeys } from "@/lib/query/query-keys";
import { useRealtimeInvalidator } from "@/lib/realtime/use-realtime-invalidator";
import {
  DEFAULT_LIVE_TRACKING_FILTERS,
  matchesLiveTrackingFilters,
  type LiveTrackingFilterState,
} from "./live-tracking-filters";
import { FleetOverviewPanel } from "./fleet-overview-panel";
import { LiveDriverDetailsPanel } from "./live-driver-details-panel";
import { TrackingInsightsPanel } from "./tracking-insights-panel";
import { TrackingQuickActions } from "./tracking-quick-actions";
import {
  TrackingCommandLayout,
  TrackingMapStage,
} from "./tracking-shell";
import {
  TrackingMapLegend,
  TrackingMapToolbar,
  type MapLayerToggle,
} from "./tracking-map-overlays";
import {
  LEGEND_FILTERABLE_STATUSES,
  fleetStatusFromLocation,
  type FleetStatusKey,
} from "./tracking-status";
import type { LiveDriverMeta, LiveRecentDelivery } from "./live-tracking-types";
import type { GeofenceMapOverlay } from "@/features/locations/geofence-map-overlays";
import { buildTrackingMapStyles } from "./tracking-map-google-styles";
import {
  DEFAULT_TRACKING_MAP_PREFS,
  loadTrackingMapPrefs,
  nativeMapTypeForStyle,
  saveTrackingMapPrefs,
  type TrackingMapLayerPrefs,
} from "./tracking-map-layer-prefs";
import { cn } from "@/lib/utils";
import type { TrackingViewTab } from "./tracking-tab-switcher";

export function LiveTrackingLiveView({
  fullscreen,
  activeTab,
  onTabChange,
}: {
  fullscreen?: boolean;
  activeTab: TrackingViewTab;
  onTabChange: (tab: TrackingViewTab) => void;
}) {
  const t = useTranslations("pages.liveTracking");
  const { locations } = useDriverLocationsRealtime();
  const [filters, setFilters] = useState<LiveTrackingFilterState>(DEFAULT_LIVE_TRACKING_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapLayer, setMapLayer] = useState<MapLayerToggle>("live");
  const [geofencesEnabled, setGeofencesEnabled] = useState(false);
  const [clusterCount, setClusterCount] = useState(0);
  const [mapOnlyFullscreen, setMapOnlyFullscreen] = useState(false);
  const [mapPrefs, setMapPrefs] = useState<TrackingMapLayerPrefs>(DEFAULT_TRACKING_MAP_PREFS);
  const [visibleStatuses, setVisibleStatuses] = useState<FleetStatusKey[]>(
    LEGEND_FILTERABLE_STATUSES,
  );
  const [mapActions, setMapActions] = useState<{
    recenter: () => void;
    zoomIn: () => void;
    zoomOut: () => void;
  } | null>(null);
  /** Re-evaluate GPS freshness every 30s so stale drivers drop off the map. */
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    setMapPrefs(loadTrackingMapPrefs());
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const { data: driversMeta = [] } = useQuery({
    queryKey: queryKeys.drivers.list({ archived: false }),
    queryFn: () => fetchDriversForAdmin({ archived: false }),
  });

  const { data: zones = [] } = useQuery({
    queryKey: queryKeys.zones.list(),
    queryFn: fetchZones,
  });

  // Live driver positions arrive via useDriverLocationsRealtime above. The
  // driver meta (names, zone/partner assignments) and the zone overlays come
  // from regular Supabase queries, so subscribe to their tables here so the
  // map auto-updates when a driver/intake is approved or a zone is edited.
  useRealtimeInvalidator({
    channel: "admin-live-tracking-meta",
    tables: [
      { table: "drivers" },
      { table: "driver_intakes" },
      { table: "zones" },
      { table: "zone_geofence_settings" },
    ],
    invalidateKeys: [
      queryKeys.drivers.all(),
      queryKeys.zones.all(),
    ],
  });

  const profileMeta = useMemo(() => {
    const map = new Map<string, LiveDriverMeta>();
    for (const row of driversMeta) {
      if (!row.linked_profile_id) continue;
      map.set(row.linked_profile_id, {
        fullName: row.full_name ?? null,
        driverCode: row.driver_code ?? null,
        zoneId: row.zone_id ?? null,
        partnerId: row.partner_id ?? null,
        zoneName: row.zone_name ?? null,
        partnerName: row.partner_name ?? null,
        intakeId: row.id,
        phone: row.phone ?? null,
        detailHref: `/drivers/${row.id}?tab=location`,
        avatarUrl: row.avatar_display_url ?? null,
      });
    }
    return map;
  }, [driversMeta]);

  const enrichedLocations = useMemo(() => {
    return locations.map((loc) => {
      const meta = profileMeta.get(loc.driverId);
      const fallbackShortId = loc.driverId.slice(0, 8);
      const hasFallbackName = !loc.driverName || loc.driverName === fallbackShortId;
      return {
        ...loc,
        driverName: hasFallbackName ? (meta?.fullName ?? loc.driverName) : loc.driverName,
        driverCode: loc.driverCode === "—" ? (meta?.driverCode ?? loc.driverCode) : loc.driverCode,
      };
    });
  }, [locations, profileMeta]);

  /** Only drivers with GPS updated within the last 10 minutes appear on the live map. */
  const liveDrivers = useMemo(
    () => enrichedLocations.filter((loc) => isGpsLive(loc.lastSeenAt, nowTick)),
    [enrichedLocations, nowTick],
  );

  const staleOnDutyCount = useMemo(
    () =>
      enrichedLocations.filter(
        (loc) => !isGpsLive(loc.lastSeenAt, nowTick) && loc.isOnDuty,
      ).length,
    [enrichedLocations, nowTick],
  );

  const filtered = useMemo(() => {
    return liveDrivers.filter((loc) => {
      const meta = profileMeta.get(loc.driverId);
      if (!matchesLiveTrackingFilters(loc, filters, meta)) return false;
      const status = fleetStatusFromLocation({
        pinStatus: loc.pinStatus,
        trackingStatus: loc.trackingStatus,
        isOnDuty: loc.isOnDuty,
      });
      return visibleStatuses.includes(status);
    });
  }, [liveDrivers, filters, profileMeta, visibleStatuses]);

  const selectedDriver = useMemo(
    () => filtered.find((d) => d.driverId === selectedId) ?? null,
    [filtered, selectedId],
  );

  useEffect(() => {
    if (selectedId && !liveDrivers.some((d) => d.driverId === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, liveDrivers]);

  const selectedMeta = selectedDriver ? profileMeta.get(selectedDriver.driverId) : undefined;

  const avatarByDriverId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const row of driversMeta) {
      if (row.linked_profile_id) {
        map.set(row.linked_profile_id, row.avatar_display_url ?? null);
      }
    }
    return map;
  }, [driversMeta]);

  const { data: selectedRestaurantPins = [] } = useQuery({
    queryKey: queryKeys.liveTracking.restaurantPins(selectedId ?? ""),
    enabled: Boolean(selectedId),
    queryFn: () => fetchDriverAssignedRestaurantPins(selectedId!),
  });

  const restaurantMapMarkers = useMemo(
    () =>
      selectedRestaurantPins.map((pin) => ({
        id: pin.id,
        lat: pin.latitude,
        lng: pin.longitude,
        title: pin.name,
      })),
    [selectedRestaurantPins],
  );

  const { data: selectedRecentOrders = [] } = useQuery({
    queryKey: ["live-tracking", "recent-deliveries", selectedId],
    enabled: Boolean(selectedId),
    queryFn: async () => {
      if (!selectedId) return [];
      try {
        const rows = await fetchRecentDeliveriesForDriver(selectedId, 1);
        return rows.map<LiveRecentDelivery>((row) => ({
          id: row.id,
          driverId: row.driver_id,
          shortId: row.short_id,
          status: row.status,
          partnerName: row.partner_name,
          deliveredAt: row.delivered_at,
        }));
      } catch {
        return [];
      }
    },
  });

  const alertsCount = useMemo(
    () => liveDrivers.filter((l) => l.zoneStatus === "out_of_zone").length,
    [liveDrivers],
  );

  const mapMarkers = useMemo(
    () =>
      filtered.map((loc) => ({
        id: loc.driverId,
        lat: loc.latitude,
        lng: loc.longitude,
        title: loc.driverName,
        pinStatus: loc.pinStatus,
        trackingStatus: loc.trackingStatus,
        vehicleType: undefined as "bike" | "car" | undefined,
        heading: loc.heading,
        highlight: loc.driverId === selectedId,
      })),
    [filtered, selectedId],
  );

  const inProgressCount = useMemo(
    () => liveDrivers.filter((loc) => loc.trackingStatus === "delivery_submit").length,
    [liveDrivers],
  );

  const zoneDriverCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const loc of filtered) {
      const zoneId = profileMeta.get(loc.driverId)?.zoneId;
      if (!zoneId) continue;
      counts.set(zoneId, (counts.get(zoneId) ?? 0) + 1);
    }
    return counts;
  }, [filtered, profileMeta]);

  const geofenceOverlays = useMemo((): GeofenceMapOverlay[] => {
    if (!geofencesEnabled) return [];
    return zones
      .filter((z) => z.geometry && z.status !== "inactive")
      .map((z) => ({
        id: z.id,
        name: z.name,
        driverCount: zoneDriverCounts.get(z.id) ?? 0,
        zone_type: z.zone_type,
        geometry: z.geometry!,
        geofence_kind: z.geofence_kind,
        color: normalizeZoneColor(z.color),
        status: z.status,
      }));
  }, [zones, geofencesEnabled, zoneDriverCounts]);

  const mapHeightClass =
    fullscreen || mapOnlyFullscreen ? "min-h-0 flex-1 h-full" : "min-h-0 flex-1";

  const zoneFilterOptions = useMemo(
    () => [
      { id: "all", label: t("allZones") },
      ...zones.map((zone) => ({ id: zone.id, label: zone.name })),
    ],
    [t, zones],
  );

  const partnerFilterOptions = useMemo(() => {
    const uniq = new Map<string, string>();
    for (const row of driversMeta) {
      if (!row.partner_id || !row.partner_name) continue;
      uniq.set(row.partner_id, row.partner_name);
    }
    return [{ id: "all", label: t("allPartners") }, ...Array.from(uniq, ([id, label]) => ({ id, label }))];
  }, [driversMeta, t]);

  return (
    <TrackingCommandLayout
      fullscreen={fullscreen}
      left={
        <FleetOverviewPanel
          totalDrivers={driversMeta.length}
          trackedCount={liveDrivers.length}
          inProgressCount={inProgressCount}
          alertsCount={alertsCount}
          drivers={filtered}
          selectedDriverId={selectedId}
          onSelectDriver={(driverId) =>
            setSelectedId((prev) => (prev === driverId ? null : driverId))
          }
          avatarByDriverId={avatarByDriverId}
          filters={filters}
          onChange={setFilters}
          zoneOptions={zoneFilterOptions}
          partnerOptions={partnerFilterOptions}
          activeTab={activeTab}
          onTabChange={onTabChange}
        />
      }
      footer={
        !fullscreen && !mapOnlyFullscreen ? (
          <div className="grid gap-2 md:grid-cols-[minmax(0,1.6fr)_minmax(220px,1fr)]">
            <TrackingInsightsPanel drivers={liveDrivers} staleOnDutyCount={staleOnDutyCount} />
            <TrackingQuickActions />
          </div>
        ) : undefined
      }
      center={
        <TrackingMapStage
          fullscreen={fullscreen || mapOnlyFullscreen}
          fillParent={!fullscreen && !mapOnlyFullscreen}
          mapHeightClass={mapHeightClass}
          frameClassName={cn(
            !fullscreen && !mapOnlyFullscreen && "min-h-0 flex-1 shrink",
            mapOnlyFullscreen && "fixed inset-2 z-50 rounded-xl border bg-background shadow-2xl",
          )}
        >
          <DriverLocationsMap
            markers={mapMarkers}
            restaurantMarkers={restaurantMapMarkers}
            geofenceOverlays={geofenceOverlays}
            fitToMarkers={filtered.length > 0}
            focusMarkerId={selectedId}
            onMarkerSelect={(markerId) =>
              setSelectedId((prev) => (prev === markerId ? null : markerId))
            }
            mapHeightClass="h-full min-h-0"
            frameless
            className="h-full rounded-none border-0"
            mapStyles={buildTrackingMapStyles(mapPrefs.hideLabels, mapPrefs.mapTypeId)}
            mapTypeId={nativeMapTypeForStyle(mapPrefs.mapTypeId)}
            defaultZoom={11}
            initialFitPadding={86}
            mapLayer={mapLayer}
            onMapActionsReady={setMapActions}
            onClusterCountChange={setClusterCount}
          />
          <TrackingMapToolbar
            activeLayer={mapLayer}
            onLayerChange={setMapLayer}
            geofencesEnabled={geofencesEnabled}
            onToggleGeofences={() => setGeofencesEnabled((prev) => !prev)}
            onRecenter={() => mapActions?.recenter()}
            onMapFullscreen={() => setMapOnlyFullscreen((prev) => !prev)}
            onZoomIn={() => mapActions?.zoomIn()}
            onZoomOut={() => mapActions?.zoomOut()}
            prefs={mapPrefs}
            onPrefsChange={(next) => {
              setMapPrefs(next);
              saveTrackingMapPrefs(next);
            }}
            onToggleTraffic={(enabled) => setMapLayer(enabled ? "traffic" : "live")}
          />
          <TrackingMapLegend
            activeStatuses={visibleStatuses}
            onToggleStatus={(status) => {
              setVisibleStatuses((prev) => {
                if (prev.includes(status)) return prev.filter((item) => item !== status);
                return [...prev, status];
              });
            }}
            clusterCount={clusterCount}
          />
          {selectedDriver ? (
            <div className="pointer-events-none absolute end-2 top-2 z-30 w-[min(272px,calc(100%-1rem))]">
              <div className="pointer-events-auto">
                <LiveDriverDetailsPanel
                  driver={selectedDriver}
                  meta={selectedMeta}
                  recentOrders={selectedRecentOrders}
                  restaurantPins={selectedRestaurantPins}
                  variant="stacked"
                  onClose={() => setSelectedId(null)}
                />
              </div>
            </div>
          ) : null}
        </TrackingMapStage>
      }
    />
  );
}
