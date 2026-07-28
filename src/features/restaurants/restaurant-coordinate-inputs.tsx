"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  isValidLatitude,
  isValidLongitude,
  parseCoordinatePair,
  type RestaurantLocation,
} from "./restaurant-location-utils";

function formatCoord(n: number): string {
  return Number.isFinite(n) ? n.toFixed(6) : "";
}

function sameLocation(
  a: RestaurantLocation | null,
  b: RestaurantLocation | null,
): boolean {
  if (a === null && b === null) return true;
  if (!a || !b) return false;
  return Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9;
}

type CoordinateLabels = {
  section: string;
  latitude: string;
  longitude: string;
  hint: string;
  invalidLatitude: string;
  invalidLongitude: string;
};

export function RestaurantCoordinateInputs({
  location,
  onLocationChange,
  labels,
  disabled,
}: {
  location: RestaurantLocation | null;
  onLocationChange: (next: RestaurantLocation | null) => void;
  labels: CoordinateLabels;
  disabled?: boolean;
}) {
  const [latText, setLatText] = useState(
    location ? formatCoord(location.lat) : "",
  );
  const [lngText, setLngText] = useState(
    location ? formatCoord(location.lng) : "",
  );
  // Track the last value we pushed up so external updates (map click,
  // place search, clear pin) sync the inputs while user typing does not
  // overwrite itself.
  const lastSentRef = useRef<RestaurantLocation | null>(location);

  useEffect(() => {
    if (sameLocation(location, lastSentRef.current)) return;
    if (location) {
      setLatText(formatCoord(location.lat));
      setLngText(formatCoord(location.lng));
    } else {
      setLatText("");
      setLngText("");
    }
    lastSentRef.current = location;
  }, [location]);

  const commit = (latStr: string, lngStr: string) => {
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (isValidLatitude(lat) && isValidLongitude(lng)) {
      const next = { lat, lng };
      lastSentRef.current = next;
      onLocationChange(next);
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text");
    if (!text) return;
    const parsed = parseCoordinatePair(text);
    if (!parsed) return;
    event.preventDefault();
    setLatText(formatCoord(parsed.lat));
    setLngText(formatCoord(parsed.lng));
    lastSentRef.current = parsed;
    onLocationChange(parsed);
  };

  const latParsed = latText.trim() ? parseFloat(latText) : NaN;
  const lngParsed = lngText.trim() ? parseFloat(lngText) : NaN;
  const latError = latText.trim() && !isValidLatitude(latParsed);
  const lngError = lngText.trim() && !isValidLongitude(lngParsed);

  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
        {labels.section}
      </Label>
      <div className="grid grid-cols-2 gap-2">
        <Input
          inputMode="decimal"
          placeholder={labels.latitude}
          aria-label={labels.latitude}
          aria-invalid={Boolean(latError) || undefined}
          value={latText}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value;
            setLatText(next);
            commit(next, lngText);
          }}
          onPaste={handlePaste}
          className="rounded-lg bg-background font-mono text-sm tabular-nums"
        />
        <Input
          inputMode="decimal"
          placeholder={labels.longitude}
          aria-label={labels.longitude}
          aria-invalid={Boolean(lngError) || undefined}
          value={lngText}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value;
            setLngText(next);
            commit(latText, next);
          }}
          onPaste={handlePaste}
          className="rounded-lg bg-background font-mono text-sm tabular-nums"
        />
      </div>
      <p className="text-[11px] text-muted-foreground">{labels.hint}</p>
      {latError ? (
        <p className="text-[11px] text-destructive">{labels.invalidLatitude}</p>
      ) : null}
      {lngError ? (
        <p className="text-[11px] text-destructive">{labels.invalidLongitude}</p>
      ) : null}
    </div>
  );
}
