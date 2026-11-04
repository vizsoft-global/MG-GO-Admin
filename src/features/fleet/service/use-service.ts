"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  getOdometerSyncConfig,
  listMaintenanceSchedules,
  listServiceMaintenanceData,
  listServiceRecords,
  listServiceReportData,
  listServiceTypes,
  listServiceVehicleOptions,
  listVehicleModels,
} from "./service-actions";
import { listServiceTypeUsage } from "./service-types-actions";

export function useServiceRecords() {
  return useQuery({
    queryKey: queryKeys.service.records(),
    queryFn: () => listServiceRecords(),
  });
}

export function useServiceVehicles() {
  return useQuery({
    queryKey: queryKeys.service.vehicles(),
    queryFn: () => listServiceVehicleOptions(),
  });
}

export function useServiceTypeCatalog() {
  return useQuery({
    queryKey: queryKeys.service.types(),
    queryFn: () => listServiceTypes(),
  });
}

export function useServiceTypeUsage() {
  return useQuery({
    queryKey: queryKeys.service.typeUsage(),
    queryFn: () => listServiceTypeUsage(),
  });
}

export function useServiceReports() {
  return useQuery({
    queryKey: queryKeys.service.reports(),
    queryFn: () => listServiceReportData(),
  });
}

export function useServiceMaintenance(scope: "all" | "car" | "bike" = "all") {
  return useQuery({
    queryKey: queryKeys.service.maintenance(scope),
    queryFn: () =>
      listServiceMaintenanceData({
        vehicleTypeKeys: scope === "all" ? undefined : [scope],
      }),
  });
}

export function useOdometerSyncConfig() {
  return useQuery({
    queryKey: queryKeys.service.odometerSync(),
    queryFn: () => getOdometerSyncConfig(),
  });
}

export function useMaintenanceSchedules() {
  return useQuery({
    queryKey: queryKeys.service.schedules(),
    queryFn: () => listMaintenanceSchedules(),
  });
}

export function useVehicleModels() {
  return useQuery({
    queryKey: queryKeys.service.models(),
    queryFn: () => listVehicleModels(),
  });
}

/** Every write path answers one of these codes; the UI never prints a raw one. */
export function serviceErrorKey(code: string): string {
  switch (code) {
    case "not_authorized":
      return "errors.notAuthorized";
    case "not_configured":
      return "errors.notConfigured";
    case "future_date":
      return "errors.futureDate";
    case "invalid_date":
      return "errors.invalidDate";
    case "invalid_invoice_date":
      return "errors.invalidDate";
    case "missing_vehicle":
      return "errors.missingVehicle";
    case "missing_service_type":
      return "errors.missingType";
    case "missing_model":
      return "errors.missingModel";
    case "missing_make":
      return "errors.missingMake";
    case "missing_vehicle_type":
      return "errors.missingVehicleType";
    case "missing_program":
      return "errors.missingProgram";
    case "empty_file":
      return "errors.emptyFile";
    case "invalid_base_url":
      return "errors.invalidBaseUrl";
    case "http_error":
      return "errors.httpError";
    case "not_json":
      return "errors.notJson";
    case "request_failed":
      return "errors.requestFailed";
    case "missing_fields":
      return "errors.missingFields";
    case "invalid_key":
      return "errors.invalidKey";
    case "invalid_odometer":
      return "errors.invalidOdometer";
    case "invalid_cost":
      return "errors.invalidCost";
    case "invalid_part":
      return "errors.invalidPart";
    case "too_many_attachments":
      return "errors.tooManyAttachments";
    case "file_empty":
      return "errors.fileEmpty";
    case "file_too_large":
      return "errors.fileTooLarge";
    case "invalid_content_type":
      return "errors.invalidContentType";
    case "upload_failed":
      return "errors.uploadFailed";
    case "invalid_attachment":
      return "errors.invalidAttachment";
    case "foreign_attachment":
      return "errors.foreignAttachment";
    case "odometer_below_current":
      return "errors.odometerBelowCurrent";
    case "reason_required":
      return "errors.reasonRequired";
    case "secret_missing":
      return "errors.secretMissing";
    case "invalid_transition":
      return "errors.invalidTransition";
    case "note_required":
      return "errors.noteRequired";
    case "record_locked":
      return "errors.recordLocked";
    case "not_found":
      return "errors.notFound";
    default:
      return "errors.saveFailed";
  }
}
