"use client";

import { useMemo } from "react";
import type { DriverAssetType, DriverDocumentType } from "../types";

type CompletionInput = {
  fullName: string;
  phone: string;
  civilId: string;
  partnerId: string;
  zoneId: string;
  vehicleId: string;
  restaurantCount: number;
  assets: Record<DriverAssetType, boolean>;
  documents: Record<DriverDocumentType, File | null>;
  remoteDocumentCount: number;
  hasAvatar: boolean;
};

export function useDriverFormCompletion(input: CompletionInput): number {
  return useMemo(() => {
    const required = [input.fullName, input.phone, input.civilId];
    const requiredCount = required.filter((value) => value.trim().length > 0).length;
    const requiredRatio = requiredCount / required.length;

    const optionalChecks = [
      input.partnerId.length > 0,
      input.zoneId.length > 0,
      input.vehicleId.length > 0,
      input.restaurantCount > 0,
      Object.values(input.assets).some(Boolean),
      Object.values(input.documents).some((file) => file != null) || input.remoteDocumentCount > 0,
      input.hasAvatar,
    ];
    const optionalRatio =
      optionalChecks.filter(Boolean).length / Math.max(1, optionalChecks.length);

    return Math.round((requiredRatio * 0.7 + optionalRatio * 0.3) * 100);
  }, [input]);
}

