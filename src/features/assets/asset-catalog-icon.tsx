"use client";

import { Package, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveAssetIcon } from "./asset-icons";

export function AssetCatalogIcon({
  iconKey,
  imageUrl,
  className,
  iconClassName,
  imgClassName,
}: {
  iconKey?: string | null;
  imageUrl?: string | null;
  className?: string;
  iconClassName?: string;
  imgClassName?: string;
}) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt=""
        className={cn("h-full w-full object-contain", imgClassName, className)}
      />
    );
  }

  const Icon: LucideIcon = resolveAssetIcon(iconKey) ?? Package;
  return <Icon className={cn("h-4 w-4", iconClassName, className)} />;
}
