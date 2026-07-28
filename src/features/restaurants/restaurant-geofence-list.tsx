"use client";

import { useTranslations } from "next-intl";
import { Ban, CheckCircle2, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatZoneArea, zoneAreaSqKm } from "@/lib/geo/zone-area";
import type { RestaurantGeofenceDraft } from "./types";

export function RestaurantGeofenceList({
  geofences,
  selectedId,
  onSelect,
  onNameChange,
  onDelete,
}: {
  geofences: RestaurantGeofenceDraft[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onNameChange: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const t = useTranslations("pages.restaurants.geofences");

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-xs font-semibold text-foreground">
          {t("title")}
        </Label>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {geofences.length}
        </span>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {t("subtitle")}
      </p>

      {geofences.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-4 text-center text-[11px] text-muted-foreground">
          {t("empty")}
        </div>
      ) : (
        <ul className="max-h-48 space-y-1.5 overflow-y-auto">
          {geofences.map((geofence) => {
            const selected = geofence.id === selectedId;
            const area = formatZoneArea(
              zoneAreaSqKm(geofence.zone_type, geofence.geometry),
            );
            const KindIcon =
              geofence.kind === "inclusion" ? CheckCircle2 : Ban;

            return (
              <li key={geofence.id}>
                <div
                  className={cn(
                    "rounded-lg border p-2 transition-colors",
                    selected
                      ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
                      : "border-border bg-card hover:border-primary/30",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(selected ? null : geofence.id)}
                    className="flex w-full cursor-pointer items-start gap-2 text-start"
                  >
                    <span
                      aria-hidden
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                      style={{
                        backgroundColor: `${geofence.color}22`,
                        color: geofence.color,
                      }}
                    >
                      <KindIcon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-foreground">
                        {t(`kind.${geofence.kind}`)}
                        <span className="ms-1 font-normal text-muted-foreground">
                          · {t(`shape.${geofence.zone_type}`)}
                        </span>
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {area}
                      </span>
                    </span>
                  </button>
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      value={geofence.name ?? ""}
                      onChange={(event) =>
                        onNameChange(geofence.id, event.target.value)
                      }
                      placeholder={t("namePlaceholder")}
                      className="h-8 flex-1 rounded-lg text-xs"
                      onFocus={() => onSelect(geofence.id)}
                    />
                    <button
                      type="button"
                      onClick={() => onDelete(geofence.id)}
                      className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-destructive hover:bg-destructive/10"
                      aria-label={t("deleteOne")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
