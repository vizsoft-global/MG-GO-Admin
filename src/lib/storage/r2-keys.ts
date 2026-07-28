import type { DriverDocumentType } from "@/features/drivers/types";

const ALLOWED_PREFIXES = [
  "drivers/",
  "partners/",
  "restaurants/",
  "notifications/",
  "assets/",
  "releases/",
] as const;

export function isAllowedStorageKey(key: string): boolean {
  const normalized = key.trim().replace(/^\/+/, "");
  if (normalized.includes("..")) return false;
  return ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function isR2ObjectKey(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  if (v.startsWith("http://") || v.startsWith("https://")) return false;
  return (
    v.startsWith("drivers/") ||
    v.startsWith("driver-avatars/") ||
    v.startsWith("partners/") ||
    v.startsWith("restaurants/") ||
    v.startsWith("notifications/") ||
    v.startsWith("assets/") ||
    v.startsWith("releases/")
  );
}

export type AppReleaseChannel = "production" | "beta" | "internal";

export function buildAppReleaseApkKey(
  channel: AppReleaseChannel,
  versionCode: number,
): string {
  return `releases/android/${channel}/musallam-${versionCode}.apk`;
}

export function isAppReleaseObjectKey(key: string): boolean {
  const normalized = key.trim().replace(/^\/+/, "");
  if (normalized.includes("..")) return false;
  return normalized.startsWith("releases/android/");
}

export function buildNotificationMediaKey(assetId: string, ext: string): string {
  return `notifications/assets/${assetId}.${ext}`;
}

export function isNotificationMediaObjectKey(key: string): boolean {
  const normalized = key.trim().replace(/^\/+/, "");
  if (normalized.includes("..")) return false;
  return normalized.startsWith("notifications/assets/");
}

export function buildRestaurantLogoKey(restaurantId: string, ext: string): string {
  return `restaurants/${restaurantId}/logo.${ext}`;
}

export function allRestaurantLogoKeys(restaurantId: string): string[] {
  return ["png", "jpg", "jpeg", "webp", "svg"].map((ext) =>
    buildRestaurantLogoKey(restaurantId, ext),
  );
}

export function extensionFromMime(mime: string): "pdf" | "png" | "webp" | "jpg" {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

export function buildIntakeDocumentKey(
  intakeId: string,
  docType: DriverDocumentType,
  ext: string,
): string {
  return `drivers/intakes/${intakeId}/${docType}.${ext}`;
}

export function buildDriverDocumentKey(
  driverId: string,
  docType: DriverDocumentType,
  ext: string,
): string {
  return `drivers/${driverId}/${docType}.${ext}`;
}

export function buildIntakeAvatarKey(intakeId: string, ext: string): string {
  return `drivers/intakes/${intakeId}/avatar.${ext}`;
}

export function buildDriverAvatarKey(driverId: string, ext: string): string {
  return `drivers/${driverId}/avatar.${ext}`;
}

export function buildPartnerLogoKey(partnerId: string, ext: string): string {
  return `partners/${partnerId}/logo.${ext}`;
}

export function buildAssetCatalogImageKey(catalogItemId: string, ext: string): string {
  return `assets/catalog/${catalogItemId}/icon.${ext}`;
}

export function allAssetCatalogImageKeys(catalogItemId: string): string[] {
  return ["png", "jpg", "jpeg", "webp", "svg"].map((ext) =>
    buildAssetCatalogImageKey(catalogItemId, ext),
  );
}

/** All possible intake document keys for rollback (unknown ext per doc). */
export function allIntakeDocumentKeys(intakeId: string): string[] {
  const exts = ["pdf", "png", "jpg", "webp"] as const;
  const docTypes: DriverDocumentType[] = [
    "license",
    "civil_id",
    "work_permit",
    "passport",
  ];
  return docTypes.flatMap((docType) =>
    exts.map((ext) => buildIntakeDocumentKey(intakeId, docType, ext)),
  );
}

export function allPartnerLogoKeys(partnerId: string): string[] {
  return ["png", "jpg", "jpeg", "webp", "svg"].map((ext) =>
    buildPartnerLogoKey(partnerId, ext),
  );
}

export function allIntakeAvatarKeys(intakeId: string): string[] {
  return ["png", "jpg", "jpeg", "webp", "svg"].map((ext) =>
    buildIntakeAvatarKey(intakeId, ext),
  );
}

export function allDriverAvatarKeys(driverId: string): string[] {
  return ["png", "jpg", "jpeg", "webp", "svg"].map((ext) =>
    buildDriverAvatarKey(driverId, ext),
  );
}
