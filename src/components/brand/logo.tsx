"use client";

import Image from "next/image";
import { useBrandingOptional } from "@/contexts/branding-context";
import { DEFAULT_APP_SETTINGS, isSvgLogoUrl } from "@/lib/branding/constants";
import { cn } from "@/lib/utils";

const sizeMap = {
  sm: 32,
  md: 36,
  lg: 48,
} as const;

type LogoProps = {
  size?: keyof typeof sizeMap;
  className?: string;
  priority?: boolean;
  /** Square frame with padding — use in sidebar and compact headers */
  framed?: boolean;
};

export function Logo({
  size = "md",
  className,
  priority,
  framed = false,
}: LogoProps) {
  const branding = useBrandingOptional();
  const px = sizeMap[size];
  const logoUrl = branding?.logoUrl ?? DEFAULT_APP_SETTINGS.logo_url;
  const logoType = branding?.logoType ?? DEFAULT_APP_SETTINGS.logo_type;
  const appName = branding?.appName ?? DEFAULT_APP_SETTINGS.app_name;
  const src = logoUrl ?? DEFAULT_APP_SETTINGS.logo_url;
  const isRemote = src.startsWith("http");
  const isSvg = logoType === "svg" || isSvgLogoUrl(src);

  const image = isSvg || isRemote ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={appName}
      width={px}
      height={px}
      className={cn(
        "size-full max-h-full max-w-full object-contain",
        !framed && "shrink-0 rounded-md",
        className,
      )}
    />
  ) : (
    <Image
      src={src}
      alt={appName}
      width={px}
      height={px}
      priority={priority}
      className={cn(
        "size-full max-h-full max-w-full object-contain",
        !framed && "shrink-0 rounded-md",
        className,
      )}
    />
  );

  if (!framed) return image;

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-background",
        size === "sm" && "size-8 p-1",
        size === "md" && "size-9 p-1",
        size === "lg" && "size-12 p-1.5",
        className,
      )}
    >
      {image}
    </span>
  );
}
