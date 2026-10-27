/** Saved custom menu art. Only same-origin reads of our own uploads are kept. */

const ICON_FILE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|webp|svg)$/i;

const ICON_PATH =
  /^\/api\/menu-icons\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpe?g|webp|svg))$/i;

export const MENU_ICON_MAX_BYTES = 128 * 1024;

const MIME_EXT: Record<string, "png" | "jpg" | "webp" | "svg"> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export function menuIconObjectKey(file: string): string | null {
  if (!ICON_FILE.test(file)) return null;
  return `menu-icons/${file.toLowerCase()}`;
}

export function sanitizeMenuIconUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = ICON_PATH.exec(value.trim());
  if (!match?.[1]) return undefined;
  return `/api/menu-icons/${match[1].toLowerCase()}`;
}

export function sanitizeMenuIconColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match?.[1]) return undefined;
  return `#${match[1].toUpperCase()}`;
}

export function menuIconUploadMeta(
  type: string,
  size: number,
): { ext: "png" | "jpg" | "webp" | "svg"; contentType: string } | "icon_type" | "icon_too_large" {
  if (size <= 0 || size > MENU_ICON_MAX_BYTES) return "icon_too_large";
  const ext = MIME_EXT[type];
  if (!ext) return "icon_type";
  return { ext, contentType: type };
}

/** SVG uploaded as an <img> must not carry script or event handlers. */
export function svgIconIsSafe(source: string): boolean {
  const text = source.toLowerCase();
  if (text.includes("<script")) return false;
  if (text.includes("javascript:")) return false;
  if (text.includes("<foreignobject")) return false;
  if (/\son[a-z]+\s*=/.test(text)) return false;
  return true;
}
