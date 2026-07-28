import {
  HardHat,
  Navigation,
  Package,
  Phone,
  Shirt,
  ShoppingBag,
  Smartphone,
  type LucideIcon,
} from "lucide-react";

const ASSET_ICON_MAP: Record<string, LucideIcon> = {
  Navigation,
  Smartphone,
  Phone,
  ShoppingBag,
  HardHat,
  Shirt,
  Package,
};

export function resolveAssetIcon(iconKey: string | null | undefined): LucideIcon {
  if (!iconKey) return Package;
  return ASSET_ICON_MAP[iconKey] ?? Package;
}

export const ASSET_ICON_OPTIONS = [
  { value: "Navigation", label: "GPS" },
  { value: "Smartphone", label: "SIM / smartphone" },
  { value: "Phone", label: "Phone" },
  { value: "ShoppingBag", label: "Bag" },
  { value: "HardHat", label: "Helmet" },
  { value: "Shirt", label: "Uniform" },
  { value: "Package", label: "Generic" },
] as const;
