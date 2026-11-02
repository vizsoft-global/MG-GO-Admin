/**
 * Service Type catalog — the vocabulary a service record is filed under.
 *
 * The client supplied `Service type.xlsx` with 477 English names and no
 * categories. A category is required by the cost report and by the maintenance
 * rules, so one is derived from keywords here and stays editable per row in
 * `/settings/service-types`.
 *
 * Arabic is **not machine translated**. `label_ar` is blank after an import and
 * the UI falls back to `label_en` until the client's approved wording is
 * entered (in the editor, or through the `Arabic` column of a later sheet).
 */

export const SERVICE_CATEGORY_KEYS = [
  "engine",
  "brakes",
  "ac",
  "tyres",
  "suspension",
  "body",
  "electrical",
  "transmission",
  "consumables",
  "labour",
  "inspection",
  "other",
] as const;

export type ServiceCategoryKey = (typeof SERVICE_CATEGORY_KEYS)[number];

export const SERVICE_CATEGORY_LABELS: Record<
  ServiceCategoryKey,
  { en: string; ar: string }
> = {
  engine: { en: "Engine", ar: "المحرك" },
  brakes: { en: "Brakes", ar: "الفرامل" },
  ac: { en: "A/C", ar: "التكييف" },
  tyres: { en: "Tyres", ar: "الإطارات" },
  suspension: { en: "Suspension", ar: "التعليق" },
  body: { en: "Body", ar: "الهيكل" },
  electrical: { en: "Electrical", ar: "الكهرباء" },
  transmission: { en: "Transmission", ar: "ناقل الحركة" },
  consumables: { en: "Consumables", ar: "المستهلكات" },
  labour: { en: "Labour", ar: "الأجرة" },
  inspection: { en: "Inspection", ar: "الفحص" },
  other: { en: "Other", ar: "أخرى" },
};

export function isServiceCategoryKey(value: unknown): value is ServiceCategoryKey {
  return (
    typeof value === "string" &&
    (SERVICE_CATEGORY_KEYS as readonly string[]).includes(value)
  );
}

export function serviceCategoryLabel(
  key: ServiceCategoryKey | null | undefined,
  locale: string,
): string {
  if (!key) return SERVICE_CATEGORY_LABELS.other.en;
  const row = SERVICE_CATEGORY_LABELS[key] ?? SERVICE_CATEGORY_LABELS.other;
  return locale === "ar" ? row.ar || row.en : row.en;
}

/** Key shape the catalog document id and `vehicle_services.service_type_key` use. */
export const SERVICE_TYPE_KEY_RE = /^[a-z0-9_]{1,60}$/;

/**
 * Dedupe rule for an import: trim, collapse every run of whitespace to one
 * space, case-fold. "Full service" and "Full service " collapse to one name,
 * which is exactly the duplicate the client's sheet contains.
 */
export function normaliseServiceTypeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").replace(/\u00a0/g, " ").toLowerCase();
}

export function serviceTypeKey(name: string): string {
  const slug = normaliseServiceTypeName(name)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
    .replace(/_+$/g, "");
  return slug || "service_type";
}

type CategoryRule = { category: ServiceCategoryKey; pattern: RegExp };

/**
 * Ordered — the first rule that matches wins. Short abbreviations are anchored
 * with word boundaries so `track` cannot match `ac`.
 */
const CATEGORY_RULES: readonly CategoryRule[] = [
  {
    category: "brakes",
    pattern:
      /\b(brake|brakes|braking|pad|pads|disc|discs|rotor|rotors|caliper|calipers|abs|hand ?brake|drum)\b/,
  },
  {
    category: "tyres",
    pattern:
      /\b(tyre|tyres|tire|tires|wheel|wheels|rim|rims|puncture|tube|tubes|alignment|balancing|balancing|nitrogen|hub ?cap|spacer)\b/,
  },
  {
    category: "ac",
    pattern:
      /\b(a\/c|ac|air ?cond\w*|air ?con|compressor|condenser|evaporator|blower|freon|refrigerant|cabin ?filter|cooling coil|expansion valve|receiver drier|heater)\b/,
  },
  {
    category: "transmission",
    pattern:
      /\b(transmission|gearbox|gear ?box|gear|gears|clutch|cvt|atf|differential|drive ?shaft|propeller|prop shaft|torque converter|transfer case|synchron\w*|half ?shaft|cv joint)\b/,
  },
  {
    category: "suspension",
    pattern:
      /\b(suspension|shock|shocks|strut|struts|spring|springs|coil|bushing|bushings|bushes|ball ?joint|tie ?rod|track ?rod|stabilizer|stabiliser|sway ?bar|control arm|trailing arm|steering rack|steering|knuckle|axle|damper|hanger)\b/,
  },
  {
    category: "electrical",
    pattern:
      /\b(battery|batteries|alternator|starter|wiring|wire|fuse|fuses|relay|bulb|bulbs|lamp|lamps|light|lights|head ?light|sensor|sensors|ecu|computer|switch|horn|alarm|immobili[sz]er|radio|screen|camera|dash ?cam|charger|socket|harness|ignition|wiper ?motor|central ?lock|actuator|motor)\b/,
  },
  {
    category: "body",
    pattern:
      /\b(body|dent|dents|paint|painting|bumper|fender|door|doors|mirror|glass|windshield|windscreen|hood|bonnet|trunk|panel|grille|sill|roof|mudguard|spoiler|sunroof|chrome|sticker|wrapping|tint|tinting|number plate|plate holder|wiper blade|wiper blades)\b/,
  },
  {
    category: "engine",
    pattern:
      /\b(engine|oil|oil filter|filter|filters|air filter|fuel filter|spark|plug|plugs|piston|pistons|crank|crankshaft|camshaft|timing|belt|belts|gasket|gaskets|cylinder head|valve|valves|turbo|injector|injectors|radiator|coolant|thermostat|water pump|fuel pump|exhaust|muffler|catalyst|manifold|tappet|ring|rings|glow plug|diesel|petrol|air cleaner|pcv|egr|throttle|carburetor|carburettor|cylinder|conrod|seal|seals|hose|fan|oil pan|sump|dipstick)\b/,
  },
  {
    category: "inspection",
    pattern:
      /\b(inspection|inspect|check ?up|checking|test|testing|diagnos\w*|scan|scanning|survey|estimate|evaluation|periodic|renewal|registration|passing|report)\b/,
  },
  {
    category: "labour",
    pattern:
      /\b(labou?r|service charge|workshop charge|installation|fitting|workmanship|hand work|towing|recovery|assembly|disassembly|removal|refitting)\b/,
  },
  {
    category: "consumables",
    pattern:
      /\b(consumable|consumables|grease|additive|cleaner|cleaning|wash|washing|polish|wax|shop supplies|tape|glue|silicone|silicon|spray|cloth|gloves|oil change)\b/,
  },
];

/**
 * A category for a service type name. `other` is the honest answer for a name
 * no keyword rule recognises — it is not a guess dressed up as data.
 */
export function categoryForServiceType(name: string): ServiceCategoryKey {
  const text = normaliseServiceTypeName(name);
  if (!text) return "other";
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(text)) return rule.category;
  }
  return "other";
}

export type ServiceTypeLike = {
  key: string;
  label_en: string;
  label_ar?: string | null;
  category?: string | null;
};

/** Arabic when it exists, English otherwise — the `vehicle_types` rule. */
export function serviceTypeLabel(
  row: { label_en: string; label_ar?: string | null },
  locale: string,
): string {
  const en = (row.label_en ?? "").trim();
  const ar = (row.label_ar ?? "").trim();
  if (locale === "ar") return ar || en;
  return en || ar;
}

/** Both labels plus the category, so search hits either language or `Engine`. */
export function serviceTypeSearchText(row: ServiceTypeLike): string {
  return [
    row.label_en,
    row.label_ar ?? "",
    row.key,
    row.category ? serviceCategoryLabel(row.category as ServiceCategoryKey, "en") : "",
    row.category ? serviceCategoryLabel(row.category as ServiceCategoryKey, "ar") : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** The pill colour per category — semantic, never reused for a status. */
export const SERVICE_CATEGORY_TONE: Record<ServiceCategoryKey, string> = {
  engine: "border-sky-200 bg-sky-50 text-sky-800",
  brakes: "border-rose-200 bg-rose-50 text-rose-700",
  ac: "border-cyan-200 bg-cyan-50 text-cyan-800",
  tyres: "border-slate-200 bg-slate-100 text-slate-700",
  suspension: "border-indigo-200 bg-indigo-50 text-indigo-800",
  body: "border-amber-200 bg-amber-50 text-amber-800",
  electrical: "border-violet-200 bg-violet-50 text-violet-800",
  transmission: "border-teal-200 bg-teal-50 text-teal-800",
  consumables: "border-lime-200 bg-lime-50 text-lime-800",
  labour: "border-stone-200 bg-stone-100 text-stone-700",
  inspection: "border-emerald-200 bg-emerald-50 text-emerald-700",
  other: "border-border bg-muted/60 text-muted-foreground",
};

export function categoryTone(key: string | null | undefined): string {
  return isServiceCategoryKey(key)
    ? SERVICE_CATEGORY_TONE[key]
    : SERVICE_CATEGORY_TONE.other;
}

