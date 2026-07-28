"use client";

import { DriverFormSheet } from "./driver-form-sheet";
import type { DriverDetailModel } from "./types";

export function DriverEditSheet({
  driver,
  intakeId,
  detailRouteId,
  open,
  onOpenChange,
}: {
  driver: DriverDetailModel;
  intakeId: string;
  detailRouteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <DriverFormSheet
      mode="edit"
      driver={driver}
      intakeId={intakeId}
      detailRouteId={detailRouteId}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}
