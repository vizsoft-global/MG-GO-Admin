import { siteConfig } from "@/config/site";

export type LogoType = "image" | "svg";
export type FontFamilyId = "inter" | "roboto" | "open-sans" | "dm-sans" | "plus-jakarta-sans";

export const DEFAULT_APP_SETTINGS = {
  app_name: siteConfig.name,
  app_subtitle: "Delivery Panel",
  font_family: "inter" as FontFamilyId,
  logo_url: siteConfig.logo,
  logo_type: "image" as LogoType,
};

export const FONT_OPTIONS: { id: FontFamilyId; label: string }[] = [
  { id: "inter", label: "Inter" },
  { id: "roboto", label: "Roboto" },
  { id: "open-sans", label: "Open Sans" },
  { id: "dm-sans", label: "DM Sans" },
  { id: "plus-jakarta-sans", label: "Plus Jakarta Sans" },
];

export const ALLOWED_LOGO_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "svg"] as const;
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export const ALLOWED_SPLASH_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;
export const MAX_SPLASH_BYTES = 5 * 1024 * 1024;

export const DEFAULT_DRIVER_APP_SETTINGS = {
  driver_app_title: "Musallam Delivery",
  driver_app_maintenance_message:
    "The driver app is temporarily unavailable. Please try again later.",
  driver_app_delivery_proximity_meters: 500,
} as const;

export const MIN_DELIVERY_PROXIMITY_METERS = 0;
export const MAX_DELIVERY_PROXIMITY_METERS = 10_000;

export const DRIVER_APP_LOGO_PREFIX = "driver-app/logo";
export const DRIVER_APP_SPLASH_PREFIX = "driver-app/splash";
export const DRIVER_APP_ICON_PREFIX = "driver-app/icon";

/** Raster only — native launcher icons cannot use SVG. */
export const ALLOWED_ICON_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;
export const MAX_ICON_BYTES = 2 * 1024 * 1024;

export const LOGO_MIME_TYPES: Record<string, LogoType> = {
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
  "image/svg+xml": "svg",
};

const LOGO_EXT_META: Record<
  (typeof ALLOWED_LOGO_EXTENSIONS)[number],
  { logoType: LogoType; contentType: string }
> = {
  png: { logoType: "image", contentType: "image/png" },
  jpg: { logoType: "image", contentType: "image/jpeg" },
  jpeg: { logoType: "image", contentType: "image/jpeg" },
  webp: { logoType: "image", contentType: "image/webp" },
  svg: { logoType: "svg", contentType: "image/svg+xml" },
};

/** Browsers often omit file.type for SVG — infer from extension when needed. */
export function resolveLogoUploadMeta(
  file: File,
): { ext: string; logoType: LogoType; contentType: string } | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_LOGO_EXTENSIONS.includes(ext as (typeof ALLOWED_LOGO_EXTENSIONS)[number])) {
    return null;
  }

  const byMime = file.type ? LOGO_MIME_TYPES[file.type] : undefined;
  if (byMime) {
    return { ext, logoType: byMime, contentType: file.type };
  }

  const byExt = LOGO_EXT_META[ext as (typeof ALLOWED_LOGO_EXTENSIONS)[number]];
  if (!byExt) return null;

  return { ext, logoType: byExt.logoType, contentType: byExt.contentType };
}

export function isSvgLogoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /\.svg(\?|#|$)/i.test(url);
}

export function isFontFamilyId(value: string): value is FontFamilyId {
  return FONT_OPTIONS.some((f) => f.id === value);
}
