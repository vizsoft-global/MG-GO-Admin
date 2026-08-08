import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createPolygonDrawController,
  POLYGON_OVERLAY_TYPE,
} from "./polygon-draw-controller";
import type { GoogleMapInstance, GoogleMapsApi } from "@/lib/google-maps/load";

function createFakeGoogle(): GoogleMapsApi {
  const listeners = new Map<string, Set<() => void>>();
  const map = {
    setOptions() {},
    addListener(event: string, handler: () => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
      return {
        remove() {
          listeners.get(event)?.delete(handler);
        },
      };
    },
    // test helper
    _emit(event: string, payload?: unknown) {
      for (const handler of listeners.get(event) ?? []) {
        (handler as (p?: unknown) => void)(payload);
      }
    },
  } as GoogleMapInstance & { _emit: (e: string, p?: unknown) => void };

  return {
    maps: {
      Map: function Map() {
        return map;
      },
      Polygon: function Polygon(opts: { paths?: unknown; map?: unknown }) {
        return {
          setMap() {},
          setOptions() {},
          setEditable() {},
          setDraggable() {},
          getPath() {
            const paths = (opts.paths as Array<{ lat: number; lng: number }>) ?? [];
            return {
              getLength: () => paths.length,
              getAt: (i: number) => paths[i],
              addListener() {},
            };
          },
          addListener() {},
          _opts: opts,
        };
      },
      Marker: function Marker() {
        return {
          setMap() {},
          addListener() {},
          setPosition() {},
          getPosition() {
            return null;
          },
        };
      },
      SymbolPath: { CIRCLE: 0 },
      event: { clearInstanceListeners() {} },
      LatLngBounds: function LatLngBounds() {
        return { extend() {}, getNorthEast() {}, getSouthWest() {} };
      },
      // unused stubs
      Circle: function Circle() {
        return {};
      },
      LatLng: function LatLng() {
        return {};
      },
      MVCArray: function MVCArray() {
        return {};
      },
      OverlayView: function OverlayView() {},
      geometry: {},
      places: {},
    },
  } as unknown as GoogleMapsApi;
}

describe("createPolygonDrawController", () => {
  it("emits provisional paths at 3+ vertices so Save can enable before finish", () => {
    const google = createFakeGoogle();
    const map = new google.maps.Map(
      null as unknown as HTMLElement,
      {},
    ) as GoogleMapInstance & { _emit: (e: string, p?: unknown) => void };

    const provisional: Array<Array<{ lat: number; lng: number }> | null> = [];
    let completed = 0;

    const dm = createPolygonDrawController(google, map, {
      polygonOptions: { strokeColor: "#000" },
      onProvisionalPaths: (paths) => {
        provisional.push(paths);
      },
    });
    dm.addListener("overlaycomplete", () => {
      completed += 1;
    });
    dm.setDrawingMode(POLYGON_OVERLAY_TYPE);

    const click = (lat: number, lng: number) => {
      map._emit("click", {
        latLng: { lat: () => lat, lng: () => lng },
      });
    };

    click(29.3, 47.9);
    click(29.4, 47.9);
    assert.equal(provisional.at(-1), null);

    click(29.4, 48.0);
    assert.ok(provisional.at(-1));
    assert.equal(provisional.at(-1)?.length, 3);
    assert.equal(completed, 0);

    assert.equal(dm.finishDraft(), true);
    assert.equal(completed, 1);
  });

  it("setDrawingMode(null) does not wipe an in-progress sketch", () => {
    const google = createFakeGoogle();
    const map = new google.maps.Map(
      null as unknown as HTMLElement,
      {},
    ) as GoogleMapInstance & { _emit: (e: string, p?: unknown) => void };

    const provisional: Array<Array<{ lat: number; lng: number }> | null> = [];
    const dm = createPolygonDrawController(google, map, {
      polygonOptions: {},
      onProvisionalPaths: (paths) => provisional.push(paths),
    });
    dm.setDrawingMode(POLYGON_OVERLAY_TYPE);

    map._emit("click", {
      latLng: { lat: () => 29.3, lng: () => 47.9 },
    });
    map._emit("click", {
      latLng: { lat: () => 29.4, lng: () => 47.9 },
    });
    map._emit("click", {
      latLng: { lat: () => 29.4, lng: () => 48.0 },
    });
    assert.equal(provisional.at(-1)?.length, 3);

    dm.setDrawingMode(null);
    // Still able to finish after a spurious disable (React effect).
    dm.setDrawingMode(POLYGON_OVERLAY_TYPE);
    assert.equal(dm.finishDraft(), true);
  });
});
