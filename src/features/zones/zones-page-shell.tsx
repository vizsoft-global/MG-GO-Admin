"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown, Loader2, Plus, Search } from "lucide-react";
import { AppPage } from "@/components/app/app-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/auth-context";
import { LAYOUT } from "@/components/app/layout-spacing";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query/query-keys";
import { useRealtimeInvalidator } from "@/lib/realtime/use-realtime-invalidator";
import { useZonesList } from "./use-zones";
import { DriverAssignSheet } from "@/features/drivers/driver-assign-sheet";
import { ZoneGeofencesSummary, zoneMatchesKindFilter } from "./zone-geofences-summary";
import { ZoneListPanel } from "./zone-list-panel";
import { ZoneMapPanel } from "./zone-map-panel";
import type { GeofenceKind, ZoneRow } from "./types";

/** Fill the dashboard viewport between the top and bottom main padding so spacing is symmetric. */
const ZONES_VIEWPORT_HEIGHT = cn(LAYOUT.commandViewportHeight, LAYOUT.commandViewportMin);

function ZonesPageSkeleton() {
  return (
    <div className={cn("grid gap-3", ZONES_VIEWPORT_HEIGHT, "lg:grid-cols-[minmax(400px,460px)_minmax(0,1fr)]")}>
      <aside className="flex animate-pulse flex-col gap-3 rounded-xl border border-border bg-card p-3">
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-lg bg-muted/50" />
          ))}
        </div>
        <div className="h-9 rounded-lg bg-muted/50" />
        <div className="min-h-0 flex-1 rounded-lg bg-muted/30" />
      </aside>
      <div className="flex items-center justify-center rounded-xl border border-border bg-muted/20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    </div>
  );
}

function ZonesPageContent() {
  const t = useTranslations("pages.zones");
  const router = useRouter();
  const { can } = useAuth();
  const canManage = can("zones.manage");
  const canAssignDrivers = can("drivers.manage");

  const { data: zones = [], isLoading } = useZonesList();
  const [kindFilter, setKindFilter] = useState<"all" | GeofenceKind>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [assignZone, setAssignZone] = useState<ZoneRow | null>(null);

  // Live refresh: re-fetch the zone list whenever zones, their geofence
  // settings, or driver-to-zone assignments change. Covers the driver-count
  // badges in the list as well as the geofence overlays drawn on the map.
  useRealtimeInvalidator({
    channel: "admin-zones-list",
    tables: [
      { table: "zones" },
      { table: "zone_geofence_settings" },
      { table: "drivers" },
    ],
    invalidateKeys: [queryKeys.zones.all()],
  });

  const effectiveSelectedId = useMemo(() => {
    if (!selectedId) return null;
    return zones.some((z) => z.id === selectedId) ? selectedId : null;
  }, [zones, selectedId]);

  const handleAdd = () => {
    router.push("/zones/new");
  };

  const handleEdit = (zone: ZoneRow) => {
    router.push(`/zones/${zone.id}/edit`);
  };

  const filteredZones = useMemo(
    () =>
      zones.filter((z) => {
        if (!zoneMatchesKindFilter(z, kindFilter)) return false;
        const query = search.trim().toLowerCase();
        if (!query) return true;
        return (
          z.name.toLowerCase().includes(query) ||
          z.code.toLowerCase().includes(query)
        );
      }),
    [zones, kindFilter, search],
  );

  const kindChips: Array<{ id: "all" | GeofenceKind; label: string }> = [
    { id: "all", label: t("geofence.filterAll") },
    { id: "inclusion", label: t("geofence.filterInclusion") },
    { id: "exclusion", label: t("geofence.filterExclusion") },
  ];

  if (isLoading && zones.length === 0) {
    return (
      <AppPage className="!space-y-0">
        <ZonesPageSkeleton />
      </AppPage>
    );
  }

  return (
    <AppPage className="!space-y-0">
      <div
        className={cn(
          "grid min-h-0 gap-3 overflow-hidden",
          ZONES_VIEWPORT_HEIGHT,
          "lg:grid-cols-[minmax(400px,460px)_minmax(0,1fr)]",
        )}
      >
        <aside className="flex min-h-0 flex-col gap-3 overflow-hidden">
          <ZoneGeofencesSummary zones={zones} compact />

          <div className="shrink-0 space-y-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="relative">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("placeholders.searchZones")}
                className="h-9 rounded-lg border-slate-200 bg-slate-50 ps-8 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex h-8 flex-1 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium shadow-xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800">
                  {t("geofence.bulkActions")}
                  <ChevronDown className="ms-1 h-3.5 w-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  <DropdownMenuItem disabled>{t("geofence.bulkEnable")}</DropdownMenuItem>
                  <DropdownMenuItem disabled>{t("geofence.bulkDisable")}</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled>{t("geofence.bulkDelete")}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {canManage ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-8 w-full cursor-pointer rounded-lg sm:w-auto sm:min-w-[9.5rem]"
                  onClick={handleAdd}
                >
                  <Plus className="me-1.5 h-3.5 w-3.5" />
                  {t("geofence.createButton")}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            <ZoneListPanel
              zones={filteredZones}
              chips={kindChips}
              kindFilter={kindFilter}
              selectedId={effectiveSelectedId}
              isLoading={isLoading}
              onKindFilterChange={setKindFilter}
              onSelect={setSelectedId}
              onEdit={handleEdit}
              canAssignDrivers={canAssignDrivers}
              onAssignDrivers={setAssignZone}
            />
          </div>
        </aside>

        <ZoneMapPanel
          zones={filteredZones}
          selectedId={effectiveSelectedId}
          onZoneSelect={setSelectedId}
          className="h-full min-h-0"
        />
      </div>
      {assignZone ? (
        <DriverAssignSheet
          open={Boolean(assignZone)}
          onOpenChange={(open) => !open && setAssignZone(null)}
          mode="zone"
          entityId={assignZone.id}
          entityName={assignZone.name}
          defaultZoneId={assignZone.id}
        />
      ) : null}
    </AppPage>
  );
}

export function ZonesPageShell() {
  return <ZonesPageContent />;
}
