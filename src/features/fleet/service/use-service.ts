"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
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

export function useServiceMaintenance() {
  return useQuery({
    queryKey: queryKeys.service.maintenance(),
    queryFn: () => listServiceMaintenanceData(),
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
    case "odometer_below_current":
      return "errors.odometerBelowCurrent";
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
