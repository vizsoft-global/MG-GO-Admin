import { toKuwaitYmd } from "@/features/fleet/fleet-labels";

export const FLEET_FUEL_REQUEST_TYPES = ["fuel", "fuel_refund"] as const;
export type FleetFuelRequestType = (typeof FLEET_FUEL_REQUEST_TYPES)[number];

export const FLEET_QUEUE_REQUEST_TYPES = ["fuel", "fuel_refund", "asset"] as const;
export type FleetQueueRequestType = (typeof FLEET_QUEUE_REQUEST_TYPES)[number];

export const FUEL_REQUEST_ATTACHMENT_KINDS = ["clear_fuel_invoice", "vehicle_plate"] as const;
export const FUEL_REFUND_ATTACHMENT_KINDS = [
  "rejected_fuel_invoice",
  "cash_invoice",
  "vehicle_photo",
  "odometer",
] as const;
export const ASSET_REQUEST_ATTACHMENT_KINDS = ["handover_form", "signed_acknowledgment"] as const;

export function resolveFleetRequestVehicleId(input: {
  requestVehicleId: string | null;
  driverVehicleId: string | null;
  fillVehicleId: string | null;
}): string | null {
  return input.requestVehicleId ?? input.driverVehicleId ?? input.fillVehicleId;
}

export function fleetDepartmentLabel(roleKey: string | null | undefined): "Fleet" | "Accounts" | null {
  if (!roleKey) return null;
  if (roleKey === "system" || roleKey === "manager") return "Fleet";
  if (roleKey === "accounts") return "Accounts";
  return null;
}

export function kuwaitMonthPrefix(iso: string): string {
  return toKuwaitYmd(iso).slice(0, 7);
}

export function requestNumberThisMonth(createdAt: string, siblingCreatedAts: string[]): number {
  const month = kuwaitMonthPrefix(createdAt);
  const sameMonth = siblingCreatedAts
    .filter((iso) => kuwaitMonthPrefix(iso) === month)
    .sort((a, b) => a.localeCompare(b));
  const index = sameMonth.findIndex((iso) => iso === createdAt);
  return index >= 0 ? index + 1 : sameMonth.length + 1;
}

export function monthlyAmountTotal(
  createdAt: string,
  siblings: Array<{ created_at: string; amount_kwd: number | null }>,
): number {
  const month = kuwaitMonthPrefix(createdAt);
  return siblings
    .filter((row) => kuwaitMonthPrefix(row.created_at) === month)
    .reduce((sum, row) => sum + (row.amount_kwd ?? 0), 0);
}

export function requiredAttachmentKinds(type: FleetQueueRequestType): readonly string[] {
  if (type === "fuel") return FUEL_REQUEST_ATTACHMENT_KINDS;
  if (type === "fuel_refund") return FUEL_REFUND_ATTACHMENT_KINDS;
  return ASSET_REQUEST_ATTACHMENT_KINDS;
}

export function formatPeriodMonth(value: string | null | undefined): string {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return value;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : value;
}

export function mergeRequiredAttachments(
  type: FleetQueueRequestType,
  attachments: Array<{
    id: string;
    title?: string | null;
    kind: string | null;
    file_name: string | null;
    storage_key: string;
    captured_at: string | null;
    source: string | null;
    created_at: string;
  }>,
): Array<{
  id: string;
  title: string;
  kind: string | null;
  file_name: string | null;
  storage_key: string;
  captured_at: string | null;
  source: string | null;
  created_at: string;
}> {
  const kinds = requiredAttachmentKinds(type);
  const byKind = new Map<string, (typeof attachments)[number]>();
  const extras: typeof attachments = [];
  for (const item of attachments) {
    if (item.kind && kinds.includes(item.kind) && !byKind.has(item.kind)) {
      byKind.set(item.kind, item);
    } else {
      extras.push(item);
    }
  }
  const mapped = (item: (typeof attachments)[number]) => ({
    id: item.id,
    title: item.title || item.file_name || item.kind || "Attachment",
    kind: item.kind,
    file_name: item.file_name,
    storage_key: item.storage_key,
    captured_at: item.captured_at ?? item.created_at,
    source: item.source,
    created_at: item.created_at,
  });
  return [
    ...kinds.map((kind) => {
      const found = byKind.get(kind);
      return found
        ? mapped(found)
        : {
            id: kind,
            title: kind,
            kind,
            file_name: null,
            storage_key: "",
            captured_at: null,
            source: null,
            created_at: "",
          };
    }),
    ...extras.map(mapped),
  ];
}

export function fleetRequestMatchesSearch(
  row: {
    request_code: string;
    driver_name: string;
    employee_id: string | null;
    employee_company: string | null;
    vehicle_company: string | null;
    plate: string | null;
    item?: string | null;
  },
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    row.request_code,
    row.driver_name,
    row.employee_id,
    row.employee_company,
    row.vehicle_company,
    row.plate,
    row.item,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(needle);
}
