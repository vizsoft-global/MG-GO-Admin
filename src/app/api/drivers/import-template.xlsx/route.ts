import * as XLSX from "xlsx";
import {
  TEMPLATE_COLUMNS_PARAM,
  resolveTemplateColumns,
  templateDriversAoa,
  templateGuideAoa,
  type DriverImportCustomColumn,
} from "@/features/drivers/import/template";
import {
  partnersLookupAoa,
  restaurantsLookupAoa,
  zonesLookupAoa,
} from "@/features/drivers/import/lookups";
import { fetchDriverImportLookups } from "@/features/drivers/drivers-import-actions";
import { createClient } from "@/lib/supabase/server";
import {
  DRIVER_ENTITY_TYPE,
  type CustomFieldOption,
  type CustomFieldType,
} from "@/lib/custom-fields/types";

export async function GET(request: Request) {
  const supabase = await createClient();
  const [{ data: defs }, lookups] = await Promise.all([
    supabase
      .from("custom_field_definitions")
      .select("key, label, field_type, options")
      .eq("entity_type", DRIVER_ENTITY_TYPE)
      .eq("is_active", true)
      .is("archived_at", null)
      .order("sort_order", { ascending: true }),
    fetchDriverImportLookups(),
  ]);

  const customColumns: DriverImportCustomColumn[] = (defs ?? []).map((d) => ({
    key: d.key,
    label: d.label || d.key,
    field_type: d.field_type as CustomFieldType,
    options: Array.isArray(d.options) ? (d.options as CustomFieldOption[]) : [],
  }));

  // Absent means the caller expressed no preference, which has to stay
  // distinguishable from an empty selection or the plain template link would
  // download nothing but the pinned identity + assignment columns.
  const raw = new URL(request.url).searchParams.get(TEMPLATE_COLUMNS_PARAM);
  const selected =
    raw === null ? null : raw.split(",").map((s) => s.trim()).filter(Boolean);
  const columns = resolveTemplateColumns(selected, customColumns);

  const lists =
    "error" in lookups
      ? { restaurants: [], zones: [], partners: [] }
      : lookups;

  const wb = XLSX.utils.book_new();
  const restaurantExample =
    lists.restaurants.find((row) => row.importable && row.restaurant_code)
      ?.restaurant_code ||
    lists.restaurants.find((row) => row.importable)?.name ||
    "";
  const zoneExample = lists.zones[0]?.id || "";
  const documented = columns.map((column) => {
    if (column.field === "restaurant_ids" && restaurantExample) {
      return { ...column, example: restaurantExample };
    }
    if (column.field === "zone_id" && zoneExample) {
      return { ...column, example: zoneExample };
    }
    return column;
  });

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(templateDriversAoa(documented)),
    "Drivers",
  );
  const guide = XLSX.utils.aoa_to_sheet(templateGuideAoa(documented));
  guide["!cols"] = [{ wch: 26 }, { wch: 18 }, { wch: 74 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, guide, "Guide");
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
