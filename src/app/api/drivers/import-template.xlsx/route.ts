import * as XLSX from "xlsx";
import {
  DRIVER_IMPORT_HEADERS,
  DRIVER_IMPORT_SAMPLE_ROW,
} from "@/features/drivers/import/template";
import {
  partnersLookupAoa,
  restaurantsLookupAoa,
  zonesLookupAoa,
} from "@/features/drivers/import/lookups";
import { fetchDriverImportLookups } from "@/features/drivers/drivers-import-actions";
import { createClient } from "@/lib/supabase/server";
import { DRIVER_ENTITY_TYPE } from "@/lib/custom-fields/types";

export async function GET() {
  const supabase = await createClient();
  const [{ data: defs }, lookups] = await Promise.all([
    supabase
      .from("custom_field_definitions")
      .select("key, label")
      .eq("entity_type", DRIVER_ENTITY_TYPE)
      .eq("is_active", true)
      .is("archived_at", null)
      .order("sort_order", { ascending: true }),
    fetchDriverImportLookups(),
  ]);

  const customHeaders = (defs ?? []).map((d) => d.label || d.key);
  const customSample = (defs ?? []).map(() => "");
  const lists =
    "error" in lookups
      ? { restaurants: [], zones: [], partners: [] }
      : lookups;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      [...DRIVER_IMPORT_HEADERS, ...customHeaders],
      [...DRIVER_IMPORT_SAMPLE_ROW, ...customSample],
    ]),
    "Drivers",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(restaurantsLookupAoa(lists.restaurants)),
    "Restaurants",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(zonesLookupAoa(lists.zones)),
    "Zones",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(partnersLookupAoa(lists.partners)),
    "Partners",
  );
  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="dpd-driver-import-template.xlsx"',
    },
  });
}
