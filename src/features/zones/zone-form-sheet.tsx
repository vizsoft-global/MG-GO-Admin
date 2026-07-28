"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  MAX_RADIUS_METERS,
  MIN_RADIUS_METERS,
  suggestZoneCode,
  zoneMapBoundsFromShape,
  type ZoneGeometryType,
  type ZoneGeoFeature,
} from "@/lib/geo/zone-geometry";
import { ZoneColorPicker } from "./zone-color-picker";
import {
  isPaletteColor,
  pickAutoZoneColor,
  normalizeZoneColor,
} from "./zone-colors";
import { ZoneMap } from "./zone-map";
import { ZonePlaceSearch } from "./zone-place-search";
import type {
  ZoneMapAdapter,
  ZoneMapViewport,
} from "./zone-map-adapter";
import { DEFAULT_GEOFENCE_SETTINGS } from "./geofence-defaults";
import {
  ZoneAlertSettingsSection,
  ZoneAssignSettingsSection,
  ZoneGeofenceShapeSection,
  ZoneGeofenceStatusSection,
  ZoneGeofenceTypeSection,
  ZoneNotificationSettingsSection,
} from "./zone-geofence-fields";
import { createZone, updateZone } from "./zones-actions";
import { isZoneErrorKey } from "./zone-errors";
import type { ZoneGeofenceSettings, ZoneRow } from "./types";
import { formatZoneArea, zoneAreaSqKm } from "@/lib/geo/zone-area";
import {
  ZoneFormMapToolbar,
  type ZoneMapTool,
} from "./zone-form-map-toolbar";
import {
  ZoneFormFindMyLocation,
  ZoneFormMapTypeToggle,
  ZoneFormZoomControls,
} from "./zone-form-map-controls";
import { ZoneFormGeofenceList } from "./zone-form-geofence-list";

const DEFAULT_CIRCLE_RADIUS_METERS = 1000;

function clampCircleRadiusMeters(radius: number) {
  return Math.min(MAX_RADIUS_METERS, Math.max(MIN_RADIUS_METERS, radius));
}

const DESCRIPTION_MAX = 150;

function fitMapToGeometry(
  adapter: ZoneMapAdapter,
  zoneType: ZoneGeometryType,
  geometry: ZoneGeoFeature,
) {
  const corners = zoneMapBoundsFromShape(zoneType, geometry);
  if (!corners) return;
  const [[south, west], [north, east]] = corners;
  adapter.fitViewport({ west, south, east, north });
}

function zoneErrorToast(
  t: ReturnType<typeof useTranslations<"pages.zones">>,
  error?: string,
) {
  if (error && isZoneErrorKey(error)) {
    return t(`errors.${error}`);
  }
  return t("errors.save_failed");
}

export type ZoneFormBodyProps = {
  zone: ZoneRow | null;
  existingZones: ZoneRow[];
  onClose: () => void;
  onSaved: () => void;
  onRequestDelete: () => void;
  /** Kept for compatibility, ignored — body always renders as full page now */
  asPage?: boolean;
};

export function ZoneFormBody({
  zone,
  existingZones,
  onClose,
  onSaved,
  onRequestDelete,
}: ZoneFormBodyProps) {
  const t = useTranslations("pages.zones");
  const { can } = useAuth();
  const canManage = can("zones.manage");
  const isEdit = Boolean(zone);
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(zone?.name ?? "");
  const [code, setCode] = useState(zone?.code ?? "");

  useEffect(() => {
    if (!zone) setCode(suggestZoneCode());
  }, [zone]);

  const [zoneType, setZoneType] = useState<ZoneGeometryType>(
    zone?.zone_type ?? "polygon",
  );
  const [color, setColor] = useState(() => {
    const initial = normalizeZoneColor(
      zone?.color ?? pickAutoZoneColor(existingZones.map((z) => z.color)),
    );
    return isPaletteColor(initial)
      ? initial
      : pickAutoZoneColor(existingZones.map((z) => z.color));
  });

  useEffect(() => {
    if (!zone) {
      setColor(pickAutoZoneColor(existingZones.map((z) => z.color)));
    }
  }, [zone, existingZones]);

  const [geofence, setGeofence] = useState<ZoneGeofenceSettings>(() =>
    zone
      ? {
          geofence_kind: zone.geofence_kind,
          status: zone.status,
          description: zone.description,
          alert_on_entry: zone.alert_on_entry,
          alert_on_exit: zone.alert_on_exit,
          alert_on_dwell: zone.alert_on_dwell,
          dwell_time_seconds: zone.dwell_time_seconds,
          assign_to_all_drivers: zone.assign_to_all_drivers,
          driver_group_label: zone.driver_group_label,
          notify_in_app: zone.notify_in_app,
          notify_email: zone.notify_email,
          notify_sms: zone.notify_sms,
        }
      : { ...DEFAULT_GEOFENCE_SETTINGS },
  );
  const [geometry, setGeometry] = useState<ZoneGeoFeature | null>(
    zone?.geometry ?? null,
  );
  const [radiusInput, setRadiusInput] = useState(
    zone?.zone_type === "circle" && zone.geometry?.properties?.radiusMeters
      ? String(zone.geometry.properties.radiusMeters)
      : "1000",
  );
  const mapAdapterRef = useRef<ZoneMapAdapter | null>(null);
  const [mapAdapter, setMapAdapter] = useState<ZoneMapAdapter | null>(null);
  const [activeTool, setActiveTool] = useState<ZoneMapTool>(
    isEdit ? "edit" : "draw",
  );
  const [detailsOpen, setDetailsOpen] = useState(true);

  const driverGroupItems = useMemo(
    () =>
      [...new Set(existingZones.map((item) => item.driver_group_label).filter(Boolean))]
        .map((label) => ({
          value: label ?? "",
          label: label ?? "",
          keywords: [label ?? ""],
        })),
    [existingZones],
  );

  const handleMapReady = useCallback(
    (adapter: ZoneMapAdapter) => {
      mapAdapterRef.current = adapter;
      setMapAdapter(adapter);
      adapter.invalidateSize?.();
      if (isEdit && zone?.geometry) {
        fitMapToGeometry(adapter, zone.zone_type, zone.geometry);
        adapter.setEditing?.(true);
        adapter.setDrawMode?.(null);
      } else {
        adapter.setDrawMode?.(zoneType);
      }
    },
    [isEdit, zone?.geometry, zone?.zone_type, zoneType],
  );

  const handlePlaceSelect = useCallback(
    (place: { lat: number; lng: number; viewport?: ZoneMapViewport }) => {
      const adapter = mapAdapterRef.current;
      if (!adapter) return;
      if (place.viewport) {
        adapter.fitViewport(place.viewport);
      } else {
        adapter.panTo(place.lat, place.lng, 14);
      }
    },
    [],
  );

  const handleZoomToZone = useCallback(
    (zoneId: string) => {
      const adapter = mapAdapterRef.current;
      if (!adapter) return;
      const target = existingZones.find((z) => z.id === zoneId);
      if (!target?.geometry) return;
      fitMapToGeometry(adapter, target.zone_type, target.geometry);
    },
    [existingZones],
  );

  const handleGeometryChange = (
    geo: ZoneGeoFeature | null,
    type: ZoneGeometryType,
  ) => {
    setGeometry(geo);
    setZoneType(type);
    if (geo) {
      setActiveTool("edit");
    }
    if (geo && type === "circle" && geo.properties?.radiusMeters) {
      setRadiusInput(String(Math.round(geo.properties.radiusMeters)));
    }
  };

  useEffect(() => {
    const adapter = mapAdapterRef.current;
    if (!adapter) return;
    if (activeTool === "draw") {
      if (geometry) {
        adapter.setDrawMode?.(null);
        adapter.setEditing?.(true);
        adapter.setDragging?.(false);
      } else {
        adapter.setDrawMode?.(zoneType);
        adapter.setEditing?.(false);
        adapter.setDragging?.(false);
      }
    } else if (activeTool === "edit") {
      adapter.setDrawMode?.(null);
      adapter.setDragging?.(false);
      adapter.setEditing?.(true);
    } else if (activeTool === "move") {
      adapter.setDrawMode?.(null);
      adapter.setEditing?.(false);
      adapter.setDragging?.(true);
    } else if (activeTool === "delete") {
      adapter.deleteSelected?.();
      setActiveTool("edit");
    } else if (activeTool === "clear") {
      adapter.clearDraft?.();
      setActiveTool("draw");
    }
  }, [activeTool, zoneType, geometry]);

  const handleSave = () => {
    if (!geometry) {
      toast.error(t("errors.geometry_required"));
      return;
    }

    startTransition(async () => {
      const payload = {
        name,
        code,
        color,
        zone_type: zoneType,
        geometry,
        geofence,
      };

      const result =
        isEdit && zone
          ? await updateZone({ id: zone.id, ...payload })
          : await createZone(payload);

      if (result.error) {
        toast.error(zoneErrorToast(t, result.error));
        return;
      }

      toast.success(isEdit ? t("updated") : t("created"));
      onClose();
      onSaved();
    });
  };

  const draftArea = geometry
    ? formatZoneArea(zoneAreaSqKm(zoneType, geometry))
    : "—";

  const description = geofence.description ?? "";
  const descriptionUsed = description.length;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[minmax(340px,380px)_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <header className="space-y-1 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            <Link href="/zones" className="hover:text-primary hover:underline">
              {t("geofence.pageTitle")}
            </Link>
            <span className="px-1.5 text-slate-300">/</span>
            <span className="text-slate-700 dark:text-slate-200">
              {isEdit ? t("editZoneTitle") : t("addZoneTitle")}
            </span>
          </p>
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-50">
            {isEdit
              ? t("geofence.formEditTitle")
              : t("geofence.formCreateTitle")}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {isEdit
              ? t("geofence.formEditSubtitle")
              : t("geofence.formCreateSubtitle")}
          </p>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <section className="rounded-xl border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              className="flex w-full cursor-pointer items-center justify-between px-3 py-2.5 text-start"
              onClick={() => setDetailsOpen((open) => !open)}
              aria-expanded={detailsOpen}
            >
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                {t("geofence.geofenceDetailsTitle")}
              </span>
              {detailsOpen ? (
                <ChevronUp className="h-3.5 w-3.5 text-slate-500" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
              )}
            </button>
            {detailsOpen ? (
              <div className="space-y-3 border-t border-slate-200 px-3 py-3 dark:border-slate-700">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="zone-name"
                    className="text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    {t("geofence.geofenceNameRequired")}
                  </Label>
                  <Input
                    id="zone-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={t("geofence.geofenceNamePlaceholder")}
                    className="h-9 rounded-lg"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between">
                    <Label
                      htmlFor="zone-description"
                      className="text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      {t("geofence.descriptionOptional")}
                    </Label>
                    <span className="text-[10px] tabular-nums text-slate-400">
                      {descriptionUsed}/{DESCRIPTION_MAX}
                    </span>
                  </div>
                  <Textarea
                    id="zone-description"
                    value={description}
                    onChange={(event) =>
                      setGeofence((current) => ({
                        ...current,
                        description: event.target.value.slice(
                          0,
                          DESCRIPTION_MAX,
                        ),
                      }))
                    }
                    rows={2}
                    placeholder={t("geofence.descriptionPlaceholder")}
                    className="min-h-[64px] resize-none rounded-lg text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="zone-code"
                    className="text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    {t("fieldCode")}
                  </Label>
                  <Input
                    id="zone-code"
                    value={code}
                    onChange={(event) =>
                      setCode(event.target.value.toUpperCase())
                    }
                    placeholder="ZN-1025"
                    className="h-9 rounded-lg font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    {t("fieldColor")}
                  </Label>
                  <ZoneColorPicker value={color} onChange={setColor} />
                </div>
                <ZoneGeofenceStatusSection
                  value={geofence}
                  onChange={setGeofence}
                />
              </div>
            ) : null}
          </section>

          <ZoneGeofenceTypeSection value={geofence} onChange={setGeofence} />

          <ZoneGeofenceShapeSection
            value={zoneType}
            onChange={(next) => {
              setZoneType(next);
              setGeometry(null);
              setActiveTool("draw");
              mapAdapterRef.current?.clearDraft?.();
              mapAdapterRef.current?.setDrawMode?.(next);
            }}
          />

          {zoneType === "circle" ? (
            <div className="space-y-1.5">
              <Label
                htmlFor="zone-radius"
                className="text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                {t("fieldRadius")}
              </Label>
              <Input
                id="zone-radius"
                type="number"
                min={MIN_RADIUS_METERS}
                max={MAX_RADIUS_METERS}
                value={radiusInput}
                onChange={(event) => setRadiusInput(event.target.value)}
                className="h-9 rounded-lg"
              />
            </div>
          ) : null}

          <ZoneAlertSettingsSection value={geofence} onChange={setGeofence} />
          <ZoneAssignSettingsSection
            value={geofence}
            onChange={setGeofence}
            groupItems={driverGroupItems}
          />
          <ZoneNotificationSettingsSection
            value={geofence}
            onChange={setGeofence}
          />

          <div
            className={cn(
              "rounded-lg border px-3 py-2 text-xs font-medium",
              geometry
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400"
                : "border-dashed border-slate-300 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400",
            )}
          >
            {geometry ? t("geometryReady") : t("geometryPending")}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/60">
          {isEdit && canManage ? (
            <Button
              type="button"
              variant="outline"
              className="h-9 cursor-pointer rounded-lg border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={onRequestDelete}
              disabled={isPending}
              aria-label={t("deleteZone")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="h-9 cursor-pointer rounded-lg"
              onClick={onClose}
              disabled={isPending}
            >
              {t("cancel")}
            </Button>
          )}
          <div className="flex items-center gap-2">
            {isEdit && canManage ? (
              <Button
                type="button"
                variant="outline"
                className="h-9 cursor-pointer rounded-lg"
                onClick={onClose}
                disabled={isPending}
              >
                {t("cancel")}
              </Button>
            ) : null}
            <Button
              type="button"
              className="h-9 cursor-pointer rounded-lg bg-blue-600 px-4 text-sm text-white hover:bg-blue-700"
              onClick={handleSave}
              disabled={
                isPending || !name.trim() || !code.trim() || !geometry
              }
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("geofence.saveGeofence")
              )}
            </Button>
          </div>
        </footer>
      </aside>

      <section className="flex min-h-0 flex-col">
        <div className="zones-draw-map-wrapper zones-draw-map-wrapper--modal relative min-h-[420px] flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-2 px-3 pt-3">
            <div className="pointer-events-auto flex flex-wrap items-center gap-2">
              <ZoneFormMapToolbar
                activeTool={activeTool}
                onToolChange={setActiveTool}
                labels={{
                  draw: t("geofence.mapToolDraw"),
                  move: t("geofence.mapToolMove"),
                  delete: t("geofence.mapToolDelete"),
                  clear: t("geofence.mapToolClear"),
                }}
              />
              <span className="hidden rounded-lg border border-slate-200 bg-white/95 px-3 py-1.5 text-[11px] font-medium text-slate-600 shadow-sm md:inline-flex dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-300">
                {t("geofence.drawHint")}
              </span>
            </div>
            <div className="pointer-events-auto flex items-center gap-2">
              <ZoneFormGeofenceList
                zones={existingZones}
                onZoneSelect={handleZoomToZone}
              />
              <button
                type="button"
                onClick={onClose}
                aria-label={t("geofence.closeForm")}
                className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-md transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center px-3 md:hidden">
            <span className="pointer-events-auto rounded-lg border border-slate-200 bg-white/95 px-3 py-1.5 text-[11px] font-medium text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-300">
              {t("geofence.drawHint")}
            </span>
          </div>

          <div className="pointer-events-none absolute end-3 top-20 z-20 hidden md:block">
            <div className="pointer-events-auto">
              <ZonePlaceSearch
                onSelect={handlePlaceSelect}
                className="w-72"
              />
            </div>
          </div>

          <div className="pointer-events-none absolute end-3 top-20 z-20 flex flex-col items-end gap-2 md:start-auto md:top-32">
            <div className="pointer-events-auto">
              <ZoneFormMapTypeToggle adapter={mapAdapter} />
            </div>
            <div className="pointer-events-auto">
              <ZoneFormZoomControls adapter={mapAdapter} />
            </div>
            <div className="pointer-events-auto">
              <ZoneFormFindMyLocation adapter={mapAdapter} />
            </div>
          </div>

          <div className="pointer-events-none absolute bottom-3 start-3 z-20">
            <div
              className="pointer-events-auto rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-md dark:border-slate-700 dark:bg-slate-900/95"
              style={{ borderLeftColor: color, borderLeftWidth: 4 }}
            >
              <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                {name.trim() || t("geofence.unnamed")}
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                {t("geofence.colArea")}: {draftArea}
              </p>
            </div>
          </div>

          <ZoneMap
            zones={existingZones}
            selectedId={null}
            excludeZoneId={zone?.id ?? null}
            drawMode={zoneType}
            draftColor={color}
            draftGeometry={geometry}
            draftZoneType={zoneType}
            draftCircleRadiusMeters={clampCircleRadiusMeters(
              Number.parseFloat(radiusInput) || DEFAULT_CIRCLE_RADIUS_METERS,
            )}
            onDraftGeometryChange={handleGeometryChange}
            onMapReady={handleMapReady}
            className="zones-google-map h-full w-full"
          />
        </div>

      </section>
    </div>
  );
}
