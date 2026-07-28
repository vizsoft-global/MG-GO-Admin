"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AppSettings } from "@/lib/branding/get-app-settings";

const BrandingContext = createContext<AppSettings | null>(null);

export function BrandingProvider({
  value,
  children,
}: {
  value: AppSettings;
  children: ReactNode;
}) {
  return (
    <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
  );
}

export function useBranding(): AppSettings {
  const ctx = useContext(BrandingContext);
  if (!ctx) {
    throw new Error("useBranding must be used within BrandingProvider");
  }
  return ctx;
}

export function useBrandingOptional(): AppSettings | null {
  return useContext(BrandingContext);
}
