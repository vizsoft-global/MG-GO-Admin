import { onCall } from "firebase-functions/v2/https";
import { FieldValue, getFirestore, Timestamp } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { kuwaitDayString } from "../core/kuwait";
import { requireRider } from "../core/rider";
import {
  loadDocMap,
  logDriverOperation,
  pick,
  pickInstant,
  pickText,
  type Dict,
} from "./_shared";

const VEHICLE_HANDOVERS = "vehicle_handovers";
const VEHICLE_ACCIDENTS = "vehicle_accidents";
const VEHICLE_DOCUMENTS = "vehicle_documents";
const VEHICLE_SERVICES = "vehicle_services";
const FUEL_FILL_ATTACHMENTS = "fuel_fill_attachments";
const LEDGER_CAP = 20;
const SCAN = 80;

export const REQUIRED_FUEL_KINDS = ["fuel_receipt", "fuel_pump", "odometer"] as const;
export type RequiredFuelKind = (typeof REQUIRED_FUEL_KINDS)[number];

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function kuwaitDateOf(value: unknown): string | null {
  const date = asDate(value);
  return date ? kuwaitDayString(date) : asString(value)?.slice(0, 10) ?? null;
}

function joinName(...parts: Array<string | null | undefined>): string | null {
  const text = parts
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter((part) => part.length > 0)
    .join(" ");
  return text.length ? text : null;
}

export function defaultAttachmentTitle(kind: RequiredFuelKind): string {
  switch (kind) {
    case "fuel_receipt":
      return "Fuel receipt";
    case "fuel_pump":
      return "Fuel pump";
    case "odometer":
      return "Odometer reading";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function isRequiredFuelKind(kind: string): kind is RequiredFuelKind {
  return (REQUIRED_FUEL_KINDS as readonly string[]).includes(kind);
}

export function missingAttachmentKind(kinds: readonly string[]): RequiredFuelKind | null {
  const have = new Set(kinds.filter((kind) => kind.length > 0));
  for (const kind of REQUIRED_FUEL_KINDS) {
    if (!have.has(kind)) return kind;
  }
  return null;
}

export type FuelFillInput = {
  litres: number | null;
  costKwd: number | null;
  stationName: string | null;
  lat: number | null;
  lng: number | null;
  attachments: unknown;
};

export type FuelFillOk = {
  ok: true;
  litres: number;
  costKwd: number;
  stationName: string;
  lat: number;
  lng: number;
  attachments: Dict[];
};

export type FuelFillErr = {
  ok: false;
  error: string;
  missing_kind?: string;
};

export function validateFuelFill(input: FuelFillInput): FuelFillOk | FuelFillErr {
  if (input.litres === null || input.litres <= 0) {
    return { ok: false, error: "litres_required" };
  }
  if (input.costKwd === null || input.costKwd < 0) {
    return { ok: false, error: "cost_required" };
  }
  if (!input.stationName) {
    return { ok: false, error: "station_required" };
  }
  if (input.lat === null || input.lng === null) {
    return { ok: false, error: "location_required" };
  }
  if (!Array.isArray(input.attachments)) {
    return { ok: false, error: "attachment_required" };
  }
  const rows = input.attachments.filter((item): item is Dict => typeof item === "object" && item !== null);
  const missing = missingAttachmentKind(rows.map((row) => asString(row["kind"]) ?? ""));
  if (missing) {
    return { ok: false, error: "attachment_required", missing_kind: missing };
  }
  for (const kind of REQUIRED_FUEL_KINDS) {
    const row = rows.find((item) => asString(item["kind"]) === kind);
    if (!row || !asString(row["storage_key"]) || !asString(row["captured_at"])) {
      return { ok: false, error: "attachment_required", missing_kind: kind };
    }
  }
  return {
    ok: true,
    litres: input.litres,
    costKwd: input.costKwd,
    stationName: input.stationName,
    lat: input.lat,
    lng: input.lng,
    attachments: rows,
  };
}

export function ledgerEntry(args: {
  at: unknown;
  notes: unknown;
  kind: unknown;
  hasFile: boolean;
}): Dict {
  return {
    at: kuwaitDateOf(args.at),
    notes: asString(args.notes),
    kind: asString(args.kind),
    has_file: args.hasFile,
  };
}

function sortAt(value: unknown): number {
  return asDate(value)?.getTime() ?? 0;
}

async function loadLedger(
  collection: string,
  vehicleId: string,
  map: (raw: Dict) => { entry: Dict; at: unknown },
): Promise<Dict[]> {
  const snap = await getFirestore()
    .collection(collection)
    .where("vehicle_id", "==", vehicleId)
    .limit(SCAN)
    .get();
  return snap.docs
    .map((doc) => map((doc.data() ?? {}) as Dict))
    .sort((a, b) => sortAt(b.at) - sortAt(a.at))
    .slice(0, LEDGER_CAP)
    .map((row) => row.entry);
}

async function loadAssignedAssets(driverId: string): Promise<Dict[]> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.assetAssignments)
    .where("driver_id", "==", driverId)
    .where("status", "==", "assigned")
    .limit(SCAN)
    .get();
  const catalogIds = snap.docs
    .map((doc) => asString(((doc.data() ?? {}) as Dict)["catalog_item_id"]))
    .filter((id): id is string => Boolean(id));
  const catalog = await loadDocMap(COLLECTIONS.assetCatalog, catalogIds);
  return snap.docs
    .map((doc) => {
      const raw = (doc.data() ?? {}) as Dict;
      const item = catalog.get(asString(raw["catalog_item_id"]) ?? "");
      const kind = joinName(asString(item?.["name"]), asString(item?.["code"]) ? `· ${asString(item?.["code"])}` : null);
      return {
        at: raw["assigned_at"],
        entry: ledgerEntry({
          at: raw["assigned_at"],
          notes: raw["notes"],
          kind,
          hasFile: false,
        }),
      };
    })
    .sort((a, b) => sortAt(b.at) - sortAt(a.at))
    .slice(0, LEDGER_CAP)
    .map((row) => row.entry);
}

export const driverGetAssignedVehicle = onCall(async (request) => {
  const ctx = await requireRider(request);
  if (ctx.driver["archived_at"]) return null;
  const vehicleId = asString(ctx.driver["vehicle_id"]);
  if (!vehicleId) return null;

  const vehicleSnap = await getFirestore().collection(COLLECTIONS.vehicles).doc(vehicleId).get();
  if (!vehicleSnap.exists) return null;
  const vehicle = (vehicleSnap.data() ?? {}) as Dict;

  const [handovers, accidents, documents, services, assets] = await Promise.all([
    loadLedger(VEHICLE_HANDOVERS, vehicleId, (raw) => ({
      at: raw["handed_at"],
      entry: ledgerEntry({
        at: raw["handed_at"],
        notes: raw["notes"],
        kind: null,
        hasFile: asString(raw["storage_key"]) !== null,
      }),
    })),
    loadLedger(VEHICLE_ACCIDENTS, vehicleId, (raw) => ({
      at: raw["occurred_at"],
      entry: ledgerEntry({
        at: raw["occurred_at"],
        notes: raw["notes"],
        kind: raw["severity"],
        hasFile: asString(raw["storage_key"]) !== null,
      }),
    })),
    loadLedger(VEHICLE_DOCUMENTS, vehicleId, (raw) => ({
      at: raw["created_at"],
      entry: ledgerEntry({
        at: raw["created_at"],
        notes: raw["file_name"],
        kind: raw["doc_type"],
        hasFile: asString(raw["storage_key"]) !== null,
      }),
    })),
    loadLedger(VEHICLE_SERVICES, vehicleId, (raw) => ({
      at: raw["serviced_at"],
      entry: ledgerEntry({
        at: raw["serviced_at"],
        notes: raw["notes"],
        kind: raw["kind"],
        hasFile: false,
      }),
    })),
    loadAssignedAssets(ctx.uid),
  ]);

  return {
    vehicle_id: vehicleId,
    plate: asString(vehicle["reg_number"]),
    kind: asString(vehicle["vehicle_type_key"]),
    fuel_type: asString(vehicle["fuel_type"]),
    chip_no: asString(vehicle["chip_no"]),
    fuel_monthly_limit_kwd: typeof vehicle["fuel_monthly_limit_kwd"] === "number"
      ? vehicle["fuel_monthly_limit_kwd"]
      : null,
    model: joinName(asString(vehicle["make"]), asString(vehicle["model"])),
    condition: asString(vehicle["condition"]),
    type_of_use: asString(vehicle["type_of_use"]),
    chassis_no: asString(vehicle["chassis_no"]),
    model_year: typeof vehicle["model_year"] === "number" ? vehicle["model_year"] : null,
    car_type: asString(vehicle["car_type"]),
    status: asString(vehicle["status"]),
    handovers,
    accidents,
    documents,
    services,
    assets,
  };
});

export const driverReportFuelFill = onCall(async (request) => {
  const ctx = await requireRider(request);
  const data = (request.data ?? {}) as Dict;

  if (ctx.driver["archived_at"]) {
    return { ok: false, error: "not_a_driver" };
  }
  if (ctx.driver["is_on_duty"] !== true) {
    return { ok: false, error: "driver_off_duty" };
  }
  const vehicleId = asString(ctx.driver["vehicle_id"]);
  if (!vehicleId) {
    return { ok: false, error: "vehicle_not_assigned" };
  }

  const parsed = validateFuelFill({
    litres: (() => {
      const value = pick(data, "p_litres", "litres");
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    })(),
    costKwd: (() => {
      const value = pick(data, "p_cost_kwd", "costKwd", "cost_kwd");
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    })(),
    stationName: pickText(data, "p_station_name", "stationName", "station_name"),
    lat: (() => {
      const value = pick(data, "p_lat", "lat");
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    })(),
    lng: (() => {
      const value = pick(data, "p_lng", "lng");
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    })(),
    attachments: pick(data, "p_attachments", "attachments"),
  });
  if (!parsed.ok) return parsed;

  const filledAt = pickInstant(data, "p_filled_at", "filledAt", "filled_at") ?? new Date();
  const db = getFirestore();
  const fillRef = db.collection(COLLECTIONS.fuelFills).doc();
  const batch = db.batch();
  batch.set(fillRef, {
    driver_id: ctx.uid,
    vehicle_id: vehicleId,
    filled_at: Timestamp.fromDate(filledAt),
    litres: parsed.litres,
    cost_kwd: parsed.costKwd,
    station_name: parsed.stationName,
    lat: parsed.lat,
    lng: parsed.lng,
    created_at: FieldValue.serverTimestamp(),
  });

  for (const attachment of parsed.attachments) {
    const kind = asString(attachment["kind"]);
    if (!kind || !isRequiredFuelKind(kind)) continue;
    const storageKey = asString(attachment["storage_key"]);
    const capturedAt = asDate(attachment["captured_at"]);
    if (!storageKey || !capturedAt) {
      return { ok: false, error: "attachment_required", missing_kind: kind };
    }
    const title = asString(attachment["title"]) ?? defaultAttachmentTitle(kind);
    batch.set(db.collection(FUEL_FILL_ATTACHMENTS).doc(`${fillRef.id}_${kind}`), {
      fill_id: fillRef.id,
      kind,
      title,
      file_name: asString(attachment["file_name"]),
      storage_key: storageKey,
      captured_at: Timestamp.fromDate(capturedAt),
      source: "mobile_camera",
    });
  }

  await batch.commit();
  await logDriverOperation({
    driverId: ctx.uid,
    module: "vehicle",
    action: "fuel.fill",
    actor: ctx.uid,
    success: true,
    recordType: "fuel_fill",
    recordId: fillRef.id,
  });
  return { ok: true, id: fillRef.id };
});
