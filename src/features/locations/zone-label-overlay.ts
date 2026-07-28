"use client";

import type { GoogleMapInstance, GoogleMapsApi } from "@/lib/google-maps/load";

export function createZoneLabelOverlay(
  google: GoogleMapsApi,
  map: GoogleMapInstance,
  options: {
    position: { lat: number; lng: number };
    zoneName: string;
    zoneColor: string;
    driverCount?: number;
  },
) {
  const OverlayViewCtor = google.maps.OverlayView;

  class ZoneLabelOverlay extends OverlayViewCtor {
    private container: HTMLDivElement | null = null;

    onAdd() {
      const root = document.createElement("div");
      root.style.position = "absolute";
      root.style.transform = "translate(-50%, -50%)";
      root.style.pointerEvents = "none";
      root.style.display = "inline-flex";
      root.style.alignItems = "center";
      root.style.gap = "6px";
      root.style.zIndex = "24";

      const namePill = document.createElement("div");
      namePill.style.padding = "4px 8px";
      namePill.style.borderRadius = "999px";
      namePill.style.border = `1px solid ${options.zoneColor}66`;
      namePill.style.backgroundColor = `${options.zoneColor}22`;
      namePill.style.color = "#111827";
      namePill.style.fontSize = "10px";
      namePill.style.fontWeight = "700";
      namePill.style.textTransform = "uppercase";
      namePill.style.letterSpacing = "0.04em";
      namePill.style.whiteSpace = "nowrap";
      namePill.style.boxShadow = "0 2px 8px rgba(15, 23, 42, 0.15)";
      namePill.textContent = options.zoneName;
      root.appendChild(namePill);

      if ((options.driverCount ?? 0) > 0) {
        const countChip = document.createElement("div");
        countChip.style.minWidth = "24px";
        countChip.style.height = "24px";
        countChip.style.borderRadius = "999px";
        countChip.style.display = "inline-flex";
        countChip.style.alignItems = "center";
        countChip.style.justifyContent = "center";
        countChip.style.padding = "0 6px";
        countChip.style.backgroundColor = options.zoneColor;
        countChip.style.color = "#ffffff";
        countChip.style.fontSize = "12px";
        countChip.style.fontWeight = "700";
        countChip.style.boxShadow = "0 2px 8px rgba(15, 23, 42, 0.25)";
        countChip.textContent = String(options.driverCount);
        root.appendChild(countChip);
      }

      this.container = root;
      this.getPanes()?.floatPane?.appendChild(root);
    }

    draw() {
      if (!this.container) return;
      const projection = this.getProjection();
      if (!projection) return;
      const point = projection.fromLatLngToDivPixel(options.position);
      if (!point) return;
      this.container.style.left = `${point.x}px`;
      this.container.style.top = `${point.y}px`;
    }

    onRemove() {
      if (this.container?.parentNode) {
        this.container.parentNode.removeChild(this.container);
      }
      this.container = null;
    }
  }

  const overlay = new ZoneLabelOverlay();
  overlay.setMap(map);
  return overlay;
}
