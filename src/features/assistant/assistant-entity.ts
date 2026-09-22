import type { Permission } from "@/lib/auth/permissions";

export const ASSISTANT_ENTITY_TYPES = [
  "driver",
  "zone",
  "restaurant",
  "fleet",
  "vehicle",
  "request",
  "complaint",
  "delivery",
  "attendance",
  "payroll",
  "driver_group",
  "partner",
  "asset",
  "notification",
  "performance",
] as const;

export type AssistantEntityType = (typeof ASSISTANT_ENTITY_TYPES)[number];

export function isAssistantEntityType(value: string): value is AssistantEntityType {
  return (ASSISTANT_ENTITY_TYPES as readonly string[]).includes(value);
}

export const ENTITY_MODULE_PERMISSION: Record<AssistantEntityType, Permission> = {
  driver: "drivers.view",
  zone: "zones.view",
  restaurant: "restaurants.view",
  fleet: "vehicles.view",
  vehicle: "vehicles.view",
  request: "requests.view",
  complaint: "requests.view",
  delivery: "deliveries.view",
  attendance: "attendance.view",
  payroll: "payroll.view",
  driver_group: "driver_groups.view",
  partner: "partners.view",
  asset: "assets.view",
  notification: "notifications.view",
  performance: "performance.view",
};

export type AssistantCandidate = {
  id: string;
  label: string;
  key?: string;
};

export type AssistantQueryKind = "id" | "code" | "name" | "email" | "phone" | "ref" | "month";

export type AssistantResolveResult =
  | {
      status: "ok";
      entity_type: AssistantEntityType;
      match: AssistantCandidate;
      query_kind: AssistantQueryKind;
      focus: AssistantFocus;
    }
  | {
      status: "ambiguous";
      entity_type: AssistantEntityType;
      candidates: AssistantCandidate[];
      query_kind: AssistantQueryKind;
    }
  | { status: "not_found"; entity_type: AssistantEntityType; query_kind: AssistantQueryKind }
  | { status: "error"; error: string; entity_type: AssistantEntityType };

export type AssistantFocus = {
  entity_type: AssistantEntityType;
  id: string;
  label?: string;
  zone_id?: string;
  driver_id?: string;
};

export const ASSISTANT_LIST_CAP = 20;
export const ASSISTANT_CANDIDATE_CAP = 5;
export const ASSISTANT_RANK_CAP = 10;
export const ASSISTANT_RANK_ZONE_CAP = 15;
export const FLEET_ENTITY_ID = "fleet";
