import type {
  GoogleMapInstance,
  GoogleMapProjection,
  GoogleMapsApi,
  GoogleOverlayViewClass,
} from "@/lib/google-maps/load";
import { PIN_PULSE_RGBA } from "@/lib/ui/map-colors";
import type { PinStatus } from "./types";

type PulseOverlay = {
  setMap: (map: GoogleMapInstance | null) => void;
  setPosition: (lat: number, lng: number) => void;
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

function ensurePulseKeyframes(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("dpd-driver-pulse-keyframes")) return;
  const style = document.createElement("style");
  style.id = "dpd-driver-pulse-keyframes";
  style.textContent = `
    @keyframes dpd-driver-pulse {
      0% { transform: translate(-15px, -15px) scale(0.6); opacity: 0.7; }
      70% { transform: translate(-15px, -15px) scale(1.7); opacity: 0; }
      100% { transform: translate(-15px, -15px) scale(1.7); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

export function createDriverPulseOverlay(
  google: GoogleMapsApi,
  map: GoogleMapInstance,
  position: { lat: number; lng: number },
  pinStatus: PinStatus,
): PulseOverlay {
  const OverlayCtor = google.maps.OverlayView as GoogleOverlayViewClass;
  const overlay = new OverlayCtor();
  let node: HTMLDivElement | null = null;
  let latest = position;
  const reducedMotion = prefersReducedMotion();
  const pulseColor = PIN_PULSE_RGBA[pinStatus];

  if (!reducedMotion) {
    ensurePulseKeyframes();
  }

  (overlay as unknown as { onAdd: () => void }).onAdd = () => {
    const panes = overlay.getPanes();
    if (!panes?.overlayMouseTarget) return;
    node = document.createElement("div");
    node.style.position = "absolute";
    node.style.width = "30px";
    node.style.height = "30px";
    node.style.borderRadius = "9999px";
    node.style.background = pulseColor;
    node.style.boxShadow = `0 0 0 0 ${pulseColor}`;
    node.style.transform = "translate(-15px, -15px)";
    if (reducedMotion) {
      node.style.opacity = "0.55";
    } else {
      node.style.animation = "dpd-driver-pulse 1.8s ease-out infinite";
    }
    node.style.pointerEvents = "none";
    panes.overlayMouseTarget.appendChild(node);
  };

  (overlay as unknown as { draw: () => void }).draw = () => {
    if (!node) return;
    const projection = overlay.getProjection() as GoogleMapProjection | null;
    if (!projection) return;
    const pixel = projection.fromLatLngToDivPixel(latest);
    if (!pixel) return;
    node.style.left = `${pixel.x}px`;
    node.style.top = `${pixel.y}px`;
  };

  (overlay as unknown as { onRemove: () => void }).onRemove = () => {
    if (node?.parentNode) node.parentNode.removeChild(node);
    node = null;
  };

  overlay.setMap(map);

  return {
    setMap: (nextMap) => overlay.setMap(nextMap),
    setPosition: (lat, lng) => {
      latest = { lat, lng };
      (overlay as unknown as { draw: () => void }).draw();
    },
  };
}
