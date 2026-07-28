"use client";

import { Logo } from "@/components/brand/logo";
import { useBranding } from "@/contexts/branding-context";
import { cn } from "@/lib/utils";

type BrandMarkProps = {
  size?: "sm" | "md" | "lg";
  layout?: "row" | "stack";
  variant?: "default" | "sidebar";
  showSubtitle?: boolean;
  /** Sidebar collapsed: logo only in a square frame */
  logoOnly?: boolean;
  className?: string;
  priority?: boolean;
};

const layout = {
  sm: { gap: "gap-2", title: "text-sm", subtitle: "text-xs" },
  md: { gap: "gap-3", title: "text-sm", subtitle: "text-xs" },
  lg: { gap: "gap-3", title: "text-lg", subtitle: "text-sm" },
} as const;

export function BrandMark({
  size = "md",
  layout: brandLayout = "row",
  variant = "default",
  showSubtitle = true,
  logoOnly = false,
  className,
  priority,
}: BrandMarkProps) {
  const { appName, appSubtitle } = useBranding();
  const styles = layout[size];
  const isSidebar = variant === "sidebar";
  const framed = isSidebar || logoOnly;

  if (logoOnly) {
    return (
      <Logo
        size={size === "lg" ? "md" : "sm"}
        priority={priority}
        framed
        className={className}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex items-center",
        brandLayout === "stack" && "flex-col text-center",
        styles.gap,
        className,
      )}
    >
      <Logo
        size={size}
        priority={priority}
        framed={framed || brandLayout === "stack"}
      />
      <div
        className={cn(
          "flex min-w-0 flex-col gap-0.5",
          brandLayout === "stack" && "items-center",
        )}
      >
        <span
          className={cn(
            "truncate font-semibold tracking-tight",
            isSidebar ? "text-sidebar-foreground" : "text-foreground",
            styles.title,
          )}
        >
          {appName}
        </span>
        {showSubtitle ? (
          <span
            className={cn(
              "truncate",
              isSidebar ? "text-sidebar-foreground/70" : "text-muted-foreground",
              styles.subtitle,
            )}
          >
            {appSubtitle}
          </span>
        ) : null}
      </div>
    </div>
  );
}
