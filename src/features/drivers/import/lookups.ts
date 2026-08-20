export type RestaurantLookupRow = {
  name: string;
  restaurant_code: string | null;
  id: string;
  partner_name: string | null;
  partner_id: string | null;
  zone_name: string | null;
  zone_code: string | null;
  zone_id: string | null;
  importable: boolean;
};

export type ZoneLookupRow = {
  name: string;
  code: string | null;
  id: string;
};

export type PartnerLookupRow = {
  name: string;
  id: string;
};

export type DriverImportLookups = {
  restaurants: RestaurantLookupRow[];
  zones: ZoneLookupRow[];
  partners: PartnerLookupRow[];
};

export function restaurantsLookupAoa(
  rows: RestaurantLookupRow[],
): Array<Array<string | number>> {
  return [
    [
      "Name",
      "RST code (paste this)",
      "ID",
      "Partner (paste this)",
      "Partner ID",
      "Zone (paste this)",
      "Zone code",
      "Zone ID",
      "Importable",
    ],
    ...rows.map((row) => [
      row.name,
      row.restaurant_code ?? "",
      row.id,
      row.partner_name ?? "",
      row.partner_id ?? "",
      row.zone_name ?? "",
      row.zone_code ?? "",
      row.zone_id ?? "",
      row.importable ? "Yes" : "No",
    ]),
  ];
}

export function zonesLookupAoa(rows: ZoneLookupRow[]): Array<Array<string | number>> {
  return [
    ["Name", "Code (paste this)", "ID"],
    ...rows.map((row) => [row.name, row.code ?? "", row.id]),
  ];
}

export function partnersLookupAoa(
  rows: PartnerLookupRow[],
): Array<Array<string | number>> {
  return [
    ["Name (paste this)", "ID"],
    ...rows.map((row) => [row.name, row.id]),
  ];
}
