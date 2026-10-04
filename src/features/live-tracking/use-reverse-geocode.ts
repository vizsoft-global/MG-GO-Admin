"use client";

import { useEffect, useState } from "react";

/**
 * Reverse-geocoded street address for a rider's latest fix (QA #47).
 *
 * V2's driver details panel already resolved an address from the Google Maps Geocoder inline;
 * V1 showed the zone name and two coordinates and nothing else, so an operator had to hover a
 * raw latitude to know which street a rider was on. This is the same lookup, extracted once so
 * the popup and the details panel cannot disagree about where the rider is.
 *
 * Three things it deliberately does not do:
 *
 * - **No Maps SDK dependency of its own.** `window.google.maps.Geocoder` only exists once the
 *   Maps script has loaded, which is the page's job. Absent (or still loading) means `null`,
 *   and the caller falls back to coordinates — a geocode that blanks the row is worse than no
 *   address at all.
 * - **No retry loop.** A failed or `ZERO_RESULTS` lookup is the normal outcome for a rider
 *   parked on a road Google has no street number for. Re-asking on a timer would spend quota
 *   on an answer that is not coming.
 * - **No state for the previous fix.** The address belongs to the coordinates it was resolved
 *   for, so the resolved value is stored *with* its coordinates and only handed back while those
 *   are still the ones on screen. Holding the old street while the marker has moved would be a
 *   stale claim, which is the same class of bug as a stale speed.
 */
export function useReverseGeocode(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): string | null {
  /**
   * The coordinates are kept beside the answer on purpose. Clearing the address in an effect when
   * the fix changes (the obvious shape) repaints twice and still leaves one frame where the new
   * pin carries the old street; comparing here instead means the caller can never observe an
   * address that does not belong to the fix it is rendering.
   */
  const [resolved, setResolved] = useState<{
    lat: number;
    lng: number;
    address: string | null;
  } | null>(null);
  const lat = latitude ?? null;
  const lng = longitude ?? null;
  const usable =
    lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);

  useEffect(() => {
    if (!usable) return;

    const geocoder = window.google?.maps?.Geocoder
      ? new window.google.maps.Geocoder()
      : null;
    if (!geocoder) return;

    let cancelled = false;
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      // The rider can move again while a lookup is in flight, so a late answer must not
      // overwrite the address of the fix we are now showing.
      if (cancelled) return;
      setResolved({
        lat,
        lng,
        address:
          status === "OK" && results?.[0]?.formatted_address
            ? results[0].formatted_address
            : null,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [lat, lng, usable]);

  if (!usable) return null;
  if (!resolved || resolved.lat !== lat || resolved.lng !== lng) return null;
  return resolved.address;
}
