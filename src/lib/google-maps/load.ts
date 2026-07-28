/** Minimal Google Maps JS API surface (avoids @types/google.maps dependency). */

export type GoogleMapLatLng = { lat: number; lng: number };

export type GoogleMapLatLngLiteral = GoogleMapLatLng;

export type GoogleLatLngBounds = {
  extend: (point: GoogleMapLatLng) => void;
  getNorthEast: () => GoogleMapLatLng;
  getSouthWest: () => GoogleMapLatLng;
};

export type GoogleMapStyleRule = {
  featureType?: string;
  elementType?: string;
  stylers: Array<Record<string, string>>;
};

export type GoogleMapInstance = {
  setCenter: (center: GoogleMapLatLng) => void;
  setZoom: (zoom: number) => void;
  getZoom: () => number | undefined;
  panTo: (center: GoogleMapLatLng) => void;
  setMapTypeId: (id: string) => void;
  setOptions: (opts: { styles?: GoogleMapStyleRule[]; mapTypeId?: string }) => void;
  addListener: (event: string, handler: () => void) => { remove: () => void };
  fitBounds: (
    bounds: GoogleLatLngBounds,
    padding?: number | { top?: number; right?: number; bottom?: number; left?: number },
  ) => void;
};

export type GoogleMarkerInstance = {
  setPosition: (position: GoogleMapLatLng) => void;
  setMap: (map: GoogleMapInstance | null) => void;
  getPosition: () => { lat: () => number; lng: () => number } | null | undefined;
  addListener: (event: string, handler: () => void) => void;
};

export type GoogleMVCArray<T> = {
  getLength: () => number;
  getAt: (index: number) => T;
  addListener: (event: string, handler: () => void) => void;
};

export type GooglePolygonInstance = {
  setMap: (map: GoogleMapInstance | null) => void;
  setOptions: (opts: Record<string, unknown>) => void;
  setEditable: (editable: boolean) => void;
  setDraggable: (draggable: boolean) => void;
  getPath: () => GoogleMVCArray<GoogleMapLatLng>;
  addListener: (event: string, handler: () => void) => void;
};

export type GoogleCircleInstance = {
  setMap: (map: GoogleMapInstance | null) => void;
  setOptions: (opts: Record<string, unknown>) => void;
  setEditable: (editable: boolean) => void;
  setDraggable: (draggable: boolean) => void;
  getCenter: () => { lat: () => number; lng: () => number } | null | undefined;
  getRadius: () => number;
  addListener: (event: string, handler: () => void) => void;
};

export type GoogleOverlayLayer = {
  setMap: (map: GoogleMapInstance | null) => void;
};

export type GoogleWeightedLocation = {
  location: GoogleMapLatLng;
  weight?: number;
};

export type GoogleHeatmapLayerInstance = {
  setMap: (map: GoogleMapInstance | null) => void;
  setData: (data: GoogleWeightedLocation[] | GoogleMVCArray<GoogleWeightedLocation>) => void;
  setOptions: (opts: {
    radius?: number;
    opacity?: number;
    gradient?: string[];
    dissipating?: boolean;
  }) => void;
};

export type GoogleMapPoint = { x: number; y: number };

export type GoogleMapProjection = {
  fromLatLngToDivPixel: (
    latLng: GoogleMapLatLng | { lat: () => number; lng: () => number },
  ) => GoogleMapPoint | null;
};

export type GoogleMapPanes = {
  overlayMouseTarget?: HTMLElement;
  floatPane?: HTMLElement;
};

/** Base class for custom map overlays (zone name labels). */
export type GoogleOverlayViewClass = new () => {
  setMap: (map: GoogleMapInstance | null) => void;
  getPanes: () => GoogleMapPanes | null;
  getProjection: () => GoogleMapProjection | null;
  onAdd(): void;
  draw(): void;
  onRemove(): void;
};

export type GoogleOverlayViewInstance = InstanceType<GoogleOverlayViewClass>;

export type GoogleDrawingManagerInstance = {
  setMap: (map: GoogleMapInstance | null) => void;
  setDrawingMode: (mode: string | null) => void;
  addListener: (event: string, handler: (e: GoogleOverlayCompleteEvent) => void) => void;
};

export type GoogleOverlayCompleteEvent = {
  type: string;
  overlay: GooglePolygonInstance | GoogleCircleInstance;
};

export type GoogleMapsApi = {
  maps: {
    Map: new (
      el: HTMLElement,
      opts: {
        center: GoogleMapLatLng;
        zoom: number;
        disableDefaultUI?: boolean;
        zoomControl?: boolean;
        mapTypeControl?: boolean;
        streetViewControl?: boolean;
        fullscreenControl?: boolean;
        clickableIcons?: boolean;
        gestureHandling?: "cooperative" | "greedy" | "none" | "auto";
        mapTypeId?: string;
        styles?: GoogleMapStyleRule[];
      },
    ) => GoogleMapInstance;
    Marker: new (opts: {
      position: GoogleMapLatLng;
      map: GoogleMapInstance | null;
      draggable?: boolean;
      title?: string;
      icon?:
        | {
            path: number | string;
            scale?: number;
            fillColor?: string;
            fillOpacity?: number;
            strokeColor?: string;
            strokeOpacity?: number;
            strokeWeight?: number;
            rotation?: number;
          }
        | {
            url: string;
            scaledSize?: { width: number; height: number };
            anchor?: { x: number; y: number };
          };
      zIndex?: number;
    }) => GoogleMarkerInstance;
    Polygon: new (opts: {
      paths: GoogleMapLatLng[] | GoogleMVCArray<GoogleMapLatLng>;
      map?: GoogleMapInstance | null;
      strokeColor?: string;
      strokeOpacity?: number;
      strokeWeight?: number;
      fillColor?: string;
      fillOpacity?: number;
      clickable?: boolean;
      editable?: boolean;
      draggable?: boolean;
      zIndex?: number;
    }) => GooglePolygonInstance;
    Circle: new (opts: {
      center: GoogleMapLatLng;
      radius: number;
      map?: GoogleMapInstance | null;
      strokeColor?: string;
      strokeOpacity?: number;
      strokeWeight?: number;
      fillColor?: string;
      fillOpacity?: number;
      clickable?: boolean;
      editable?: boolean;
      draggable?: boolean;
      zIndex?: number;
    }) => GoogleCircleInstance;
    LatLngBounds: new () => GoogleLatLngBounds;
    LatLng: new (lat: number, lng: number) => GoogleMapLatLng;
    SymbolPath: {
      CIRCLE: number;
    };
    TrafficLayer: new () => GoogleOverlayLayer;
    TransitLayer: new () => GoogleOverlayLayer;
    BicyclingLayer: new () => GoogleOverlayLayer;
    OverlayView: GoogleOverlayViewClass;
    event: {
      clearInstanceListeners: (instance: object) => void;
      addListener: (
        instance: GoogleMapInstance | GooglePolygonInstance | GoogleCircleInstance,
        event: string,
        handler: (e: { latLng: { lat: () => number; lng: () => number } | null }) => void,
      ) => void;
    };
    places: {
      AutocompleteService: new () => {
        getPlacePredictions: (
          request: {
            input: string;
            componentRestrictions?: { country: string | string[] };
          },
          callback: (
            predictions: Array<{ place_id: string; description: string }> | null,
            status: string,
          ) => void,
        ) => void;
      };
      PlacesService: new (attributionNode: HTMLElement) => {
        getDetails: (
          request: { placeId: string; fields: string[] },
          callback: (
            place: {
              geometry?: {
                location?: { lat: () => number; lng: () => number };
                viewport?: {
                  getNorthEast: () => { lat: () => number; lng: () => number };
                  getSouthWest: () => { lat: () => number; lng: () => number };
                };
              };
            } | null,
            status: string,
          ) => void,
        ) => void;
      };
      PlacesServiceStatus: { OK: string };
    };
    drawing: {
      DrawingManager: new (opts: {
        map?: GoogleMapInstance | null;
        drawingMode?: string | null;
        drawingControl?: boolean;
        polygonOptions?: Record<string, unknown>;
        circleOptions?: Record<string, unknown>;
      }) => GoogleDrawingManagerInstance;
      OverlayType: {
        POLYGON: string;
        CIRCLE: string;
      };
    };
    visualization?: {
      HeatmapLayer: new (opts: {
        data?: GoogleWeightedLocation[] | GoogleMVCArray<GoogleWeightedLocation>;
        map?: GoogleMapInstance | null;
        radius?: number;
        opacity?: number;
        gradient?: string[];
        dissipating?: boolean;
      }) => GoogleHeatmapLayerInstance;
    };
  };
};

/** @deprecated Use GoogleMapsApi */
export type GoogleMapsPlacesApi = GoogleMapsApi;

export type GoogleMapsLoadFailure =
  | "missing_key"
  | "auth_failure"
  | "load_error";

declare global {
  interface Window {
    google?: GoogleMapsApi;
    gm_authFailure?: () => void;
    __dpdGoogleMapsInit?: () => void;
  }
}

let loadPromise: Promise<GoogleMapsApi | null> | null = null;
let lastFailure: GoogleMapsLoadFailure | null = null;
let pendingResolve: ((api: GoogleMapsApi | null) => void) | null = null;

export function getGoogleMapsLoadFailure(): GoogleMapsLoadFailure | null {
  return lastFailure;
}

function installAuthFailureHandler() {
  if (typeof window === "undefined") return;
  window.gm_authFailure = () => {
    lastFailure = "auth_failure";
    loadPromise = null;
    pendingResolve?.(null);
    pendingResolve = null;
  };
}

/** Lazy-load Google Maps JS API with Places, Drawing and Visualization libraries. */
export function loadGoogleMaps(): Promise<GoogleMapsApi | null> {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }

  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
  if (!key) {
    lastFailure = "missing_key";
    return Promise.resolve(null);
  }

  if (lastFailure === "auth_failure") {
    return Promise.resolve(null);
  }

  if (window.google?.maps?.Map && window.google.maps.places) {
    lastFailure = null;
    return Promise.resolve(window.google);
  }

  if (!loadPromise) {
    installAuthFailureHandler();

    loadPromise = new Promise((resolve) => {
      pendingResolve = resolve;
      const finish = (api: GoogleMapsApi | null) => {
        pendingResolve = null;
        if (!api?.maps?.Map) {
          if (lastFailure !== "auth_failure") {
            lastFailure = lastFailure ?? "load_error";
          }
          resolve(null);
          return;
        }
        lastFailure = null;
        resolve(api);
      };

      const callbackName = "__dpdGoogleMapsInit";
      window[callbackName] = () => {
        delete window[callbackName];
        finish(window.google ?? null);
      };

      const existing = document.querySelector<HTMLScriptElement>(
        'script[data-google-maps="true"]',
      );
      if (existing) {
        if (window.google?.maps?.Map) {
          finish(window.google);
          return;
        }
        existing.addEventListener("load", () => finish(window.google ?? null));
        existing.addEventListener("error", () => {
          lastFailure = "load_error";
          finish(null);
        });
        return;
      }

      const script = document.createElement("script");
      script.dataset.googleMaps = "true";
      script.async = true;
      script.defer = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places,drawing,visualization&callback=${callbackName}&loading=async`;
      script.onerror = () => {
        lastFailure = "load_error";
        finish(null);
      };
      document.head.appendChild(script);
    });
  }

  return loadPromise;
}
