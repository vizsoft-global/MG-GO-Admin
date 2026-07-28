"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { normalizeZoneColor, ZONE_COLOR_PALETTE } from "./zone-colors";

type ZoneColorPickerProps = {
  value: string;
  onChange: (color: string) => void;
  className?: string;
};

export function ZoneColorPicker({ value, onChange, className }: ZoneColorPickerProps) {
  const t = useTranslations("pages.zones");
  const normalized = normalizeZoneColor(value);

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {ZONE_COLOR_PALETTE.map((paletteColor) => {
        const selected = paletteColor === normalized;
        return (
          <button
            key={paletteColor}
            type="button"
            title={paletteColor}
            aria-label={t("colorSwatch", { color: paletteColor })}
            aria-pressed={selected}
            className={cn(
              "h-9 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent shadow-sm transition-transform hover:scale-105",
              selected && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
            )}
            style={{ backgroundColor: paletteColor }}
            onClick={() => onChange(paletteColor)}
          />
        );
      })}
    </div>
  );
}
