import centerOfMass from "@turf/center-of-mass";
import centroid from "@turf/centroid";
import type { Feature, Polygon } from "geojson";
import { circleFromFeature } from "@/lib/geo/zone-geometry";
import type {
  GoogleMapInstance,
  GoogleMapsApi,
  GoogleOverlayViewInstance,
} from "@/lib/google-maps/load";
import { formatZoneArea, zoneAreaSqKm } from "@/lib/geo/zone-area";
import { normalizeZoneColor } from "./zone-colors";
import type { ZoneRow } from "./types";

export function zoneLabelLatLng(zone: ZoneRow): { lat: number; lng: number } | null {
  if (!zone.geometry?.geometry) return null;

  if (zone.zone_type === "circle") {
    const circle = circleFromFeature(zone.geometry);
    if (!circle) return null;
    const [lat, lng] = circle.center;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }

  if (zone.geometry.geometry.type !== "Polygon") return null;

  try {
    const center = centerOfMass(zone.geometry as Feature<Polygon>);
    const [lng, lat] = center.geometry.coordinates;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  } catch {
    /* fall through */
  }

  try {
    const center = centroid(zone.geometry as Feature<Polygon>);
    const [lng, lat] = center.geometry.coordinates;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  } catch {
    /* ignore */
  }

  return null;
}

export function createZoneLabelOverlay(
  google: GoogleMapsApi,
  map: GoogleMapInstance,
  zone: ZoneRow,
  opts: { onSelect?: (zoneId: string) => void },
): GoogleOverlayViewInstance | null {
  const position = zoneLabelLatLng(zone);
  if (!position || !google.maps.OverlayView) return null;

  const color = normalizeZoneColor(zone.color);
  const zoneId = zone.id;
  const zoneName = zone.name;
  const zoneArea = formatZoneArea(zoneAreaSqKm(zone.zone_type, zone.geometry));
  const onSelect = opts.onSelect;
  const latLng = { lat: position.lat, lng: position.lng };

  class ZoneNameLabelOverlay extends google.maps.OverlayView {
    private div: HTMLDivElement | null = null;

    override onAdd() {
      const div = document.createElement("div");
      div.className = "zone-map-label";
      div.style.setProperty("--zone-color", color);
      div.innerHTML = `<span class="zone-map-label__name">${zoneName}</span><span class="zone-map-label__area">${zoneArea}</span>`;
      div.title = zoneName;
      div.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelect?.(zoneId);
      });

      const panes = this.getPanes();
      panes?.overlayMouseTarget?.appendChild(div);
      this.div = div;
    }

    override draw() {
      if (!this.div) return;
      const projection = this.getProjection();
      if (!projection) return;
      const point = projection.fromLatLngToDivPixel(latLng);
      if (!point) return;
      this.div.style.left = `${point.x}px`;
      this.div.style.top = `${point.y}px`;
    }

    override onRemove() {
      this.div?.remove();
      this.div = null;
    }
  }

  const overlay = new ZoneNameLabelOverlay();
  overlay.setMap(map);
  return overlay;
}
