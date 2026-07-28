/** Uniform map controls for Google Maps and Leaflet zone implementations. */

export type ZoneMapViewport = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type ZoneMapType = "roadmap" | "satellite" | "hybrid" | "terrain";

export type ZoneMapAdapter = {
  panTo: (lat: number, lng: number, zoom?: number) => void;
  fitViewport: (viewport: ZoneMapViewport) => void;
  invalidateSize?: () => void;
  setDrawMode?: (mode: "polygon" | "circle" | null) => void;
  setEditing?: (enabled: boolean) => void;
  setDragging?: (enabled: boolean) => void;
  deleteSelected?: () => void;
  clearDraft?: () => void;
  setMapType?: (mapType: ZoneMapType) => void;
  zoomIn?: () => void;
  zoomOut?: () => void;
};

export function viewportFromGooglePlace(viewport: {
  getNorthEast: () => { lat: () => number; lng: () => number };
  getSouthWest: () => { lat: () => number; lng: () => number };
}): ZoneMapViewport {
  const ne = viewport.getNorthEast();
  const sw = viewport.getSouthWest();
  return {
    north: ne.lat(),
    south: sw.lat(),
    east: ne.lng(),
    west: sw.lng(),
  };
}
