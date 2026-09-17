export type VehicleFieldError =
  | "invalid_vehicle_id"
  | "invalid_plate"
  | "invalid_chassis"
  | "invalid_make"
  | "invalid_model"
  | "invalid_location"
  | "invalid_year"
  | "invalid_chip"
  | "invalid_fuel_limit"
  | "missing_fields";

export type VehicleFormValues = {
  bikeId: string;
  regNumber: string;
  chassisNo: string;
  make: string;
  model: string;
  locationText: string;
  modelYear: string;
  chipNo: string;
  fuelMonthlyLimitKwd: string;
};

const VEHICLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const PLATE_RE = /^[0-9]{1,3}\/[0-9]{1,6}$/;
const CHASSIS_RE = /^[A-Za-z0-9]{6,17}$/;
const MAKE_MODEL_RE = /^[\p{L}\p{N} \-]{1,40}$/u;
const LOCATION_RE = /^[\p{L}\p{N} \-,]{1,80}$/u;
const YEAR_RE = /^(199[0-9]|20[0-9]{2}|2100)$/;
const CHIP_RE = /^[A-Za-z0-9-]{1,32}$/;
const FUEL_RE = /^\d{1,5}(\.\d{1,3})?$/;

function trim(value: string): string {
  return value.trim();
}

export function filterVehicleId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
}

export function filterPlate(raw: string): string {
  let slash = false;
  let before = 0;
  let after = 0;
  let out = "";
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") {
      if (!slash && before < 3) {
        out += ch;
        before += 1;
      } else if (slash && after < 6) {
        out += ch;
        after += 1;
      }
    } else if (ch === "/" && !slash && before > 0) {
      out += "/";
      slash = true;
    }
  }
  return out;
}

export function filterChassis(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, "").slice(0, 17);
}

export function filterMakeModel(raw: string): string {
  return raw.replace(/[^\p{L}\p{N} \-]/gu, "").slice(0, 40);
}

export function filterLocation(raw: string): string {
  return raw.replace(/[^\p{L}\p{N} \-,]/gu, "").slice(0, 80);
}

export function filterYear(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 4);
}

export function filterChip(raw: string): string {
  return raw.replace(/[^A-Za-z0-9-]/g, "").slice(0, 32);
}

export function filterFuelLimit(raw: string): string {
  let out = "";
  let dot = false;
  let intDigits = 0;
  let frac = 0;
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") {
      if (!dot && intDigits < 5) {
        out += ch;
        intDigits += 1;
      } else if (dot && frac < 3) {
        out += ch;
        frac += 1;
      }
    } else if (ch === "." && !dot && intDigits > 0) {
      out += ".";
      dot = true;
    }
  }
  return out;
}

function optionalInvalid(value: string, re: RegExp): boolean {
  const text = trim(value);
  return text.length > 0 && !re.test(text);
}

export function validateVehicleForm(values: VehicleFormValues): VehicleFieldError | null {
  const bikeId = trim(values.bikeId);
  if (!bikeId) return "missing_fields";
  if (!VEHICLE_ID_RE.test(bikeId)) return "invalid_vehicle_id";
  if (optionalInvalid(values.regNumber, PLATE_RE)) return "invalid_plate";
  if (optionalInvalid(values.chassisNo, CHASSIS_RE)) return "invalid_chassis";
  if (optionalInvalid(values.make, MAKE_MODEL_RE)) return "invalid_make";
  if (optionalInvalid(values.model, MAKE_MODEL_RE)) return "invalid_model";
  if (optionalInvalid(values.locationText, LOCATION_RE)) return "invalid_location";
  const year = trim(values.modelYear);
  if (year && !YEAR_RE.test(year)) return "invalid_year";
  if (optionalInvalid(values.chipNo, CHIP_RE)) return "invalid_chip";
  const fuel = trim(values.fuelMonthlyLimitKwd);
  if (fuel) {
    if (!FUEL_RE.test(fuel) || Number(fuel) <= 0) return "invalid_fuel_limit";
  }
  return null;
}
