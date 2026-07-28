"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GoogleMapsStatusBanner } from "./google-maps-status-banner";
import { RestaurantPlaceSearch } from "./restaurant-place-search";
import type { RestaurantLocation } from "./restaurant-location-utils";

const RestaurantLocationPickerInner = dynamic(
  () =>
    import("./restaurant-location-picker-inner").then(
      (m) => m.RestaurantLocationPickerInner,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-muted">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

export function RestaurantLocationPicker({
  value,
  onChange,
  defaultCenter,
  className,
}: {
  value: RestaurantLocation | null;
  onChange: (next: RestaurantLocation | null) => void;
  defaultCenter?: [number, number];
  className?: string;
}) {
  const t = useTranslations("pages.restaurants");

  return (
    <div className={cn("relative h-full min-h-0 w-full", className)}>
      <div className="absolute start-3 end-3 top-3 z-10 flex flex-col gap-2">
        <GoogleMapsStatusBanner />
        <RestaurantPlaceSearch
          onSelect={onChange}
          placeholder={t("placeholders.searchPlace")}
          keyMissingHint={t("hints.googleKeyMissing")}
        />
      </div>

      <RestaurantLocationPickerInner
        value={value}
        onChange={onChange}
        defaultCenter={defaultCenter}
        className="restaurant-location-map h-full w-full"
        keyMissingHint={t("hints.googleKeyMissing")}
      />

      {value ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="absolute end-3 bottom-3 z-10 cursor-pointer rounded-lg shadow-sm"
          onClick={() => onChange(null)}
        >
          <X className="me-1.5 h-3.5 w-3.5" />
          {t("clearPin")}
        </Button>
      ) : null}

      <p className="pointer-events-none absolute start-3 bottom-3 z-10 max-w-[min(280px,70%)] rounded-md bg-background/90 px-2 py-1 text-[10px] text-muted-foreground shadow-sm backdrop-blur-sm">
        {t("hints.pickLocation")}
      </p>
    </div>
  );
}
