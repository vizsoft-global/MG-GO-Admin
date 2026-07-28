"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, MapPin, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { loadGoogleMaps, type GoogleMapsApi } from "@/lib/google-maps/load";
import { viewportFromGooglePlace, type ZoneMapViewport } from "./zone-map-adapter";

export type ZonePlaceSelection = {
  lat: number;
  lng: number;
  viewport?: ZoneMapViewport;
};

export function ZonePlaceSearch({
  onSelect,
  className,
}: {
  onSelect: (place: ZonePlaceSelection) => void;
  className?: string;
}) {
  const t = useTranslations("pages.zones");
  const [query, setQuery] = useState("");
  const [predictions, setPredictions] = useState<
    Array<{ placeId: string; description: string }>
  >([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchEnabled, setSearchEnabled] = useState<boolean | null>(null);
  const attributionRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autocompleteRef = useRef<InstanceType<
    GoogleMapsApi["maps"]["places"]["AutocompleteService"]
  > | null>(null);
  const placesRef = useRef<InstanceType<
    GoogleMapsApi["maps"]["places"]["PlacesService"]
  > | null>(null);
  const placesStatusOkRef = useRef<string>("OK");

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then((google) => {
      if (cancelled) return;
      if (!google?.maps?.places) {
        setSearchEnabled(false);
        return;
      }
      placesStatusOkRef.current =
        google.maps.places.PlacesServiceStatus?.OK ?? "OK";
      setSearchEnabled(true);
      autocompleteRef.current = new google.maps.places.AutocompleteService();
      if (attributionRef.current) {
        placesRef.current = new google.maps.places.PlacesService(
          attributionRef.current,
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!searchEnabled || !autocompleteRef.current) return;
    const q = query.trim();
    if (q.length < 2) {
      setPredictions([]);
      setOpen(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      autocompleteRef.current?.getPlacePredictions(
        {
          input: q,
          componentRestrictions: { country: "kw" },
        },
        (results, status) => {
          setLoading(false);
          if (status !== "OK" || !results?.length) {
            setPredictions([]);
            setOpen(false);
            return;
          }
          setPredictions(
            results.map((r) => ({
              placeId: r.place_id,
              description: r.description,
            })),
          );
          setOpen(true);
        },
      );
    }, 280);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, searchEnabled]);

  const handlePick = (prediction: { placeId: string; description: string }) => {
    setQuery(prediction.description);
    setOpen(false);
    setPredictions([]);

    if (!placesRef.current) return;

    const ok = placesStatusOkRef.current;
    placesRef.current.getDetails(
      { placeId: prediction.placeId, fields: ["geometry"] },
      (place, status) => {
        const loc = place?.geometry?.location;
        if (status !== ok || !loc) return;
        const lat = loc.lat();
        const lng = loc.lng();
        const viewport = place?.geometry?.viewport
          ? viewportFromGooglePlace(place.geometry.viewport)
          : undefined;
        onSelect({ lat, lng, viewport });
      },
    );
  };

  if (searchEnabled === false) {
    return (
      <div
        className={cn(
          "rounded-lg border border-border/80 bg-background/95 px-3 py-2 text-center text-xs text-muted-foreground shadow-sm backdrop-blur-sm",
          className,
        )}
      >
        {t("hints.googleKeyMissing")}
      </div>
    );
  }

  return (
    <div className={cn("relative z-20 w-full", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => predictions.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={t("placeholders.searchPlace")}
          className="h-10 rounded-lg border-border/80 bg-background/95 ps-9 shadow-sm backdrop-blur-sm"
          autoComplete="off"
        />
        {loading ? (
          <Loader2 className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>
      {open && predictions.length > 0 ? (
        <ul className="absolute start-0 end-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-md">
          {predictions.map((p) => (
            <li key={p.placeId}>
              <button
                type="button"
                className="flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-start text-sm hover:bg-muted"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handlePick(p)}
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span>{p.description}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div ref={attributionRef} className="hidden" aria-hidden />
    </div>
  );
}
