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
      "Zone",
      "Zone code",
      "Zone ID (paste this)",
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
    ["Name", "Code", "ID (paste this)"],
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

/** Active companies only — an inactive one is refused by the importer. */
export function companiesLookupAoa(
  rows: readonly { name: string; client_code: string | null; is_active: boolean; is_system: boolean }[],
): Array<Array<string | number>> {
  return [
    ["Company Name (paste this)", "Client ID", "Rider Category"],
    ...rows
      .filter((row) => row.is_active)
      .map((row) => [row.name, row.client_code ?? "", row.is_system ? "in_house" : "outsourced"]),
  ];
}
