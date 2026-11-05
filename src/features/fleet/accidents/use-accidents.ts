"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import { getAccident, listAccidentVehicles, listAccidents } from "./accident-actions";

export function useAccidents() {
  return useQuery({
    queryKey: queryKeys.accidents.list(),
    queryFn: () => listAccidents(),
  });
}

export function useAccident(id: string) {
  return useQuery({
    queryKey: queryKeys.accidents.detail(id),
    queryFn: () => getAccident(id),
    enabled: id !== "",
  });
}

export function useAccidentVehicles() {
  return useQuery({
    queryKey: queryKeys.accidents.vehicles(),
    queryFn: () => listAccidentVehicles(),
  });
}

/** Every write path answers one of these codes; the UI never prints a raw one. */
export function accidentErrorKey(code: string): string {
  switch (code) {
    case "not_authorized":
      return "errors.notAuthorized";
    case "not_configured":
      return "errors.notConfigured";
    case "missing_vehicle":
      return "errors.missingVehicle";
    case "missing_fields":
      return "errors.missingFields";
    case "location_required":
      return "errors.locationRequired";
    case "invalid_date":
      return "errors.invalidDate";
    case "future_date":
      return "errors.futureDate";
    case "invalid_location":
      return "errors.invalidLocation";
    case "invalid_driver_fault":
      return "errors.invalidDriverFault";
    case "invalid_case_status":
      return "errors.invalidCaseStatus";
    case "invalid_vehicle_case_status":
      return "errors.invalidVehicleCaseStatus";
    case "invalid_insurance_status":
      return "errors.invalidInsuranceStatus";
    case "invalid_police_status":
      return "errors.invalidPoliceStatus";
    case "invalid_amount":
      return "errors.invalidAmount";
    case "invalid_phone":
      return "errors.invalidPhone";
    case "replacement_plate_required":
      return "errors.replacementPlateRequired";
    case "too_many_attachments":
      return "errors.tooManyAttachments";
    case "invalid_attachment":
      return "errors.invalidAttachment";
    case "attachment_claimed":
      return "errors.attachmentClaimed";
    case "file_too_large":
      return "errors.fileTooLarge";
    case "upload_failed":
      return "errors.uploadFailed";
    case "not_found":
      return "errors.notFound";
    default:
      return "errors.saveFailed";
  }
}
