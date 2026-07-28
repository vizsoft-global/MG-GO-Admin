"use client";

import { useEffect, useState } from "react";
import type { DriverLiveLocation } from "./types";
import {
  getCachedDriverLocations,
  subscribeDriverLocations,
} from "./driver-locations-realtime-store";

export function useDriverLocationsRealtime(): {
  locations: DriverLiveLocation[];
  isLoading: boolean;
} {
  const [locations, setLocations] = useState<DriverLiveLocation[]>(
    () => getCachedDriverLocations(),
  );
  const [isLoading, setIsLoading] = useState(
    () => getCachedDriverLocations().length === 0,
  );

  useEffect(() => {
    return subscribeDriverLocations((next) => {
      setLocations(next);
      setIsLoading(false);
    });
  }, []);

  return { locations, isLoading };
}
