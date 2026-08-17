"use client";

/**
 * React bindings for the fleet engine.
 *
 * Only three things cross into React: the structural snapshot, one driver at a time,
 * and the animation-frame clock. Positions never do — `useFleetFrame` gives the map a
 * callback per frame and the map reads the interpolator directly, which is what keeps
 * a 500-driver 4Hz stream from turning into 2000 re-renders a second.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { createClient } from "@/lib/supabase/client";

import { FleetStore } from "./fleet-store";
import { FleetTransport } from "./fleet-transport";
import { loadFleetZones } from "./fleet-zones";
import type { FleetDriver, FleetSnapshot } from "./fleet-types";

type FleetContextValue = {
  store: FleetStore;
  transport: FleetTransport | null;
};

const FleetContext = createContext<FleetContextValue | null>(null);

export function FleetProvider({ children }: { children: React.ReactNode }) {
  /**
   * Built in a lazy state initialiser rather than an effect, so the first render
   * already has a store and the page does not paint an empty frame first. Nothing is
   * connected here — Strict Mode may build a second engine and discard it, and a
   * discarded engine that never started has nothing to clean up.
   */
  const [value] = useState<FleetContextValue>(() => {
    const store = new FleetStore();
    const supabase = createClient();
    return {
      store,
      transport: new FleetTransport({
        store,
        supabase,
        zonesLoader: () => loadFleetZones(supabase),
      }),
    };
  });

  useEffect(() => {
    const { store, transport } = value;
    // After hydration, never during it: the remembered chips are browser state the
    // server render could not know about. Applied before `start()` so the first
    // fetch already asks for the restored view.
    store.hydratePersistedFilters();
    void transport?.start();
    return () => {
      transport?.stop();
      store.dispose();
    };
  }, [value]);

  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>;
}

function useFleetContext(): FleetContextValue {
  const context = useContext(FleetContext);
  if (!context) {
    throw new Error("useFleet* must be used inside <FleetProvider>");
  }
  return context;
}

export function useFleetStore(): FleetStore {
  return useFleetContext().store;
}

export function useFleetTransport(): FleetTransport | null {
  return useFleetContext().transport;
}

/** Structural snapshot: roster, statuses, counts, filters, connection, feed. */
export function useFleetSnapshot(): FleetSnapshot {
  const { store } = useFleetContext();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Narrowed read, so a component that only needs one number is not woken by the rest. */
export function useFleetSelector<T>(selector: (snapshot: FleetSnapshot) => T): T {
  const { store } = useFleetContext();
  const getSelection = useCallback(
    () => selector(store.getSnapshot()),
    [selector, store],
  );
  return useSyncExternalStore(store.subscribe, getSelection, getSelection);
}

/**
 * One driver, throttled to the store's per-driver cadence. This is what a rail card
 * subscribes to; a card outside the virtualized window has no subscription at all.
 */
export function useFleetDriver(driverId: string | null): FleetDriver | null {
  const { store } = useFleetContext();

  const subscribe = useCallback(
    (listener: () => void) => {
      if (!driverId) return () => {};
      return store.subscribeDriver(driverId, listener);
    },
    [driverId, store],
  );

  const getSnapshot = useCallback(
    () => (driverId ? store.getDriver(driverId) : null),
    [driverId, store],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Runs `callback` on every animation frame with the *server* clock, which is the
 * time base positions are stamped in. Pauses when the tab is hidden: a background
 * tab animating 500 markers is pure battery cost, and the map is redrawn on
 * visibility anyway.
 */
export function useFleetFrame(callback: (serverNowMs: number) => void): void {
  const { store } = useFleetContext();
  const callbackRef = useRef(callback);

  // Assigned in an effect, not during render: the frame loop below reads this ref, and
  // React's rules forbid mutating a ref while rendering.
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    let handle = 0;
    let running = true;

    const loop = () => {
      if (!running) return;
      callbackRef.current(store.serverNow());
      handle = requestAnimationFrame(loop);
    };

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(handle);
      } else if (!running) {
        running = true;
        handle = requestAnimationFrame(loop);
      }
    };

    handle = requestAnimationFrame(loop);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(handle);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [store]);
}

/** Convenience for the header: a human label for the active rail. */
export function useFleetRailLabel(): {
  rail: FleetSnapshot["connection"]["rail"];
  status: FleetSnapshot["connection"]["status"];
  error: FleetSnapshot["connection"]["error"];
  staleSeconds: number;
} {
  const connection = useFleetSelector((snapshot) => snapshot.connection);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, []);

  return useMemo(
    () => ({
      rail: connection.rail,
      status: connection.status,
      error: connection.error,
      staleSeconds:
        connection.lastFrameAt === 0
          ? 0
          : Math.max(0, Math.round((now - connection.lastFrameAt) / 1000)),
    }),
    [connection, now],
  );
}
