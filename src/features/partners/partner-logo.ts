import {
  ALLOWED_LOGO_EXTENSIONS,
  LOGO_MIME_TYPES,
  MAX_LOGO_BYTES,
  type LogoType,
} from "@/lib/branding/constants";

const EXTENSION_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export function resolvePartnerLogoMeta(file: File): {
  error?: "file_too_large" | "invalid_type";
  ext?: string;
  contentType?: string;
  logoType?: LogoType;
} {
  if (file.size > MAX_LOGO_BYTES) return { error: "file_too_large" };

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_LOGO_EXTENSIONS.includes(ext as (typeof ALLOWED_LOGO_EXTENSIONS)[number])) {
    return { error: "invalid_type" };
  }

  const contentType = LOGO_MIME_TYPES[file.type]
    ? file.type
    : EXTENSION_MIME[ext];
  const logoType = contentType ? LOGO_MIME_TYPES[contentType] : undefined;

  if (!contentType || !logoType) return { error: "invalid_type" };

  return { ext, contentType, logoType };
}
