import type {
  GoogleMapInstance,
  GoogleMapsApi,
  GoogleMarkerInstance,
  GooglePolygonInstance,
} from "@/lib/google-maps/load";

/**
 * Google removed `drawing.DrawingManager` in Maps JS 3.65, so polygons are
 * drawn by collecting clicks instead. Mirrors the old manager's surface
 * (`setMap` / `setDrawingMode` / `overlaycomplete`) so call sites are unchanged.
 */
export const POLYGON_OVERLAY_TYPE = "polygon";

export type PolygonOverlayCompleteEvent = {
  type: string;
  overlay: GooglePolygonInstance;
};

export type PolygonVertex = { lat: number; lng: number };

export type PolygonDrawController = {
  setMap: (map: GoogleMapInstance | null) => void;
  setDrawingMode: (mode: string | null) => void;
  /** True while collecting vertices (before overlaycomplete). */
  isDrawing: () => boolean;
  /** Abort in-progress sketch without emitting overlaycomplete. */
  clearDraft: () => void;
  /** Close the ring if ≥3 vertices (same as dblclick / first-point click). */
  finishDraft: () => boolean;
  addListener: (
    event: string,
    handler: (e: PolygonOverlayCompleteEvent) => void,
  ) => void;
};

/** Vertices closer than this (in degrees) close the ring / ignore duplicates. */
const CLOSE_TOLERANCE_DEGREES = 0.00015;

function nearlyEqual(a: PolygonVertex, b: PolygonVertex) {
  return (
    Math.abs(a.lat - b.lat) < CLOSE_TOLERANCE_DEGREES &&
    Math.abs(a.lng - b.lng) < CLOSE_TOLERANCE_DEGREES
  );
}

export function createPolygonDrawController(
  google: GoogleMapsApi,
  initialMap: GoogleMapInstance | null,
  options: {
    polygonOptions: Record<string, unknown>;
    /** Called on every vertex change so callers can surface progress hints. */
    onVertexCountChange?: (count: number) => void;
    /**
     * Fired whenever the open ring has ≥3 vertices so the form can enable Save
     * before the user explicitly closes the polygon.
     */
    onProvisionalPaths?: (paths: PolygonVertex[] | null) => void;
  },
): PolygonDrawController {
  let map = initialMap;
  let drawing = false;
  let vertices: PolygonVertex[] = [];
  let preview: GooglePolygonInstance | null = null;
  let handles: GoogleMarkerInstance[] = [];
  let completeHandler: ((e: PolygonOverlayCompleteEvent) => void) | null = null;
  const mapListeners: Array<{ remove: () => void }> = [];
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;

  const emitProvisional = () => {
    if (vertices.length >= 3) {
      options.onProvisionalPaths?.(vertices.map((v) => ({ ...v })));
    } else {
      options.onProvisionalPaths?.(null);
    }
  };

  const clearPreview = () => {
    preview?.setMap(null);
    preview = null;
    for (const handle of handles) {
      google.maps.event.clearInstanceListeners(handle);
      handle.setMap(null);
    }
    handles = [];
  };

  const reset = () => {
    vertices = [];
    clearPreview();
    options.onVertexCountChange?.(0);
    options.onProvisionalPaths?.(null);
  };

  const renderPreview = () => {
    if (!map) return;
    clearPreview();
    if (vertices.length === 0) return;

    if (vertices.length >= 2) {
      preview = new google.maps.Polygon({
        paths: vertices.map((v) => ({ lat: v.lat, lng: v.lng })),
        map,
        ...options.polygonOptions,
        editable: false,
        draggable: false,
        clickable: false,
      });
    }

    vertices.forEach((vertex, index) => {
      const handle = new google.maps.Marker({
        position: vertex,
        map,
        title: index === 0 && vertices.length >= 3 ? "Click to finish polygon" : undefined,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: index === 0 ? 7 : 4,
          fillColor: "#ffffff",
          fillOpacity: 1,
          strokeColor: String(options.polygonOptions.strokeColor ?? "#2563eb"),
          strokeWeight: 2,
        },
        zIndex: 10,
      });
      // Clicking the first vertex closes the ring, matching the old tool.
      if (index === 0) {
        handle.addListener("click", () => {
          finish();
        });
      }
      handles.push(handle);
    });
  };

  const finish = (): boolean => {
    if (vertices.length < 3) return false;
    const paths = vertices.map((v) => ({ lat: v.lat, lng: v.lng }));
    reset();
    drawing = false;
    map?.setOptions({ disableDoubleClickZoom: false });
    if (!map) return false;

    const polygon = new google.maps.Polygon({
      paths,
      map,
      ...options.polygonOptions,
    });
    completeHandler?.({ type: POLYGON_OVERLAY_TYPE, overlay: polygon });
    return true;
  };

  const addVertex = (lat: number, lng: number) => {
    const next = { lat, lng };
    // A double-click fires click twice; ignore the duplicate before finishing.
    if (vertices.length > 0 && nearlyEqual(vertices[vertices.length - 1], next)) {
      return;
    }
    if (vertices.length >= 3 && nearlyEqual(vertices[0], next)) {
      finish();
      return;
    }
    vertices.push(next);
    options.onVertexCountChange?.(vertices.length);
    renderPreview();
    emitProvisional();
  };

  const detachMapListeners = () => {
    for (const listener of mapListeners) {
      listener.remove();
    }
    mapListeners.length = 0;
    if (keyHandler && typeof window !== "undefined") {
      window.removeEventListener("keydown", keyHandler);
      keyHandler = null;
    }
  };

  const attachMapListeners = () => {
    if (!map) return;
    detachMapListeners();

    mapListeners.push(
      map.addListener("click", ((e: {
        latLng?: { lat: () => number; lng: () => number } | null;
      }) => {
        if (!drawing) return;
        const latLng = e?.latLng;
        if (!latLng) return;
        addVertex(latLng.lat(), latLng.lng());
      }) as () => void),
    );

    mapListeners.push(
      map.addListener("dblclick", (() => {
        if (!drawing) return;
        finish();
      }) as () => void),
    );

    if (typeof window !== "undefined") {
      keyHandler = (e: KeyboardEvent) => {
        if (!drawing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          finish();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          reset();
          options.onVertexCountChange?.(0);
        }
      };
      window.addEventListener("keydown", keyHandler);
    }
  };

  attachMapListeners();

  return {
    setMap(nextMap) {
      if (nextMap === map) return;
      detachMapListeners();
      reset();
      drawing = false;
      map = nextMap;
      attachMapListeners();
    },
    setDrawingMode(mode) {
      const next = mode === POLYGON_OVERLAY_TYPE;
      if (next === drawing) return;
      drawing = next;
      // Do not reset vertices here — finish()/clearDraft()/setMap() own cleanup.
      // Resetting on every setDrawingMode(null) wiped in-progress sketches when
      // React effects re-ran after provisional geometry enabled Save.
      map?.setOptions({ disableDoubleClickZoom: next });
      if (next) {
        options.onVertexCountChange?.(vertices.length);
        emitProvisional();
      }
    },
    isDrawing: () => drawing,
    clearDraft() {
      reset();
      drawing = false;
      map?.setOptions({ disableDoubleClickZoom: false });
    },
    finishDraft: () => finish(),
    addListener(event, handler) {
      if (event === "overlaycomplete") {
        completeHandler = handler;
      }
    },
  };
}
