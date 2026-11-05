"use client";

import { createElement } from "react";
import { useTranslations } from "next-intl";
import { resolveIcon } from "@/lib/menu/menu-registry";
import { launcherGlyphSrc } from "@/lib/menu/launcher-glyphs";
import type { AppAccessLevel } from "@/lib/auth/app-access";
import { cn } from "@/lib/utils";
import {
  ACCESS_INK,
  ACCESS_LEVEL_KEY,
  ACCESS_LEVEL_PILL,
  ACCESS_TILE_BG,
  accessAvatarTint,
  accessInitials,
} from "./access-ui";

const RADIUS: Record<number, string> = {
  24: "rounded-md",
  28: "rounded-lg",
  32: "rounded-lg",
  40: "rounded-[10px]",
};

/**
 * `App Icon` (7102:17665). The exported BajajCare frame glyph paints on a warm
 * sand chip — the same treatment the launcher gives a tile — and an app the
 * frame never drew falls back to its sidebar Lucide icon on the same chip.
 */
export function AccessAppIcon({
  appId,
  iconName,
  size = 40,
  className,
}: {
  appId: string;
  iconName: string;
  size?: number;
  className?: string;
}) {
  const src = launcherGlyphSrc(appId);
  const glyphSize = Math.round(size * 0.55);
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center border border-black/15",
        RADIUS[size] ?? "rounded-[10px]",
        className,
      )}
      style={{ width: size, height: size, backgroundColor: ACCESS_TILE_BG }}
      aria-hidden
    >
      {src ? (
        // Local frame glyph; `next/image` would add a proxy hop for a 22-40px SVG.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={glyphSize} height={glyphSize} className="object-contain" />
      ) : (
        createElement(resolveIcon(iconName), {
          style: { width: glyphSize, height: glyphSize, color: ACCESS_INK },
          strokeWidth: 2,
        })
      )}
    </span>
  );
}

/** `Avatar` on a staff row / person header. */
export function AccessAvatar({
  id,
  name,
  size = 40,
  className,
}: {
  id: string;
  name: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn("grid shrink-0 place-items-center rounded-full font-semibold text-white", className)}
      style={{
        width: size,
        height: size,
        backgroundColor: accessAvatarTint(id),
        fontSize: size >= 56 ? 18 : 13,
      }}
      aria-hidden
    >
      {accessInitials(name)}
    </span>
  );
}

/** Access-level pill with its leading dot. */
export function AccessLevelPill({
  level,
  label,
  className,
}: {
  level: AppAccessLevel;
  label?: string;
  className?: string;
}) {
  const t = useTranslations("pages.settings.accessControl");
  const tone = ACCESS_LEVEL_PILL[level];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full py-[3px] ps-2 pe-2.5 text-xs font-medium",
        className,
      )}
      style={{ backgroundColor: tone.bg, color: tone.fg }}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: tone.fg }} aria-hidden />
      {label ?? t(ACCESS_LEVEL_KEY[level] as "levelManager")}
    </span>
  );
}

/** Uppercase-free neutral tag used beside a staff name (`Super Admin`, `Full access`). */
export function AccessTag({
  label,
  tone = "plum",
}: {
  label: string;
  tone?: "plum" | "green" | "grey";
}) {
  const fill = {
    plum: { bg: "#f1e6ec", fg: "#7a3b5c" },
    green: { bg: "#e4eeea", fg: "#2f5d50" },
    grey: { bg: "#eeebef", fg: "#6e6a7c" },
  }[tone];
  return (
    <span
      className="inline-flex shrink-0 items-center rounded px-1.5 py-px text-[11px] font-medium"
      style={{ backgroundColor: fill.bg, color: fill.fg }}
    >
      {label}
    </span>
  );
}
