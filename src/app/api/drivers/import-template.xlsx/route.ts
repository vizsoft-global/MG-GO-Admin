import * as XLSX from "xlsx";
import {
  DRIVER_IMPORT_HEADERS,
  DRIVER_IMPORT_SAMPLE_ROW,
} from "@/features/drivers/import/template";
import { createClient } from "@/lib/supabase/server";
import { DRIVER_ENTITY_TYPE } from "@/lib/custom-fields/types";

export async function GET() {
  const supabase = await createClient();
  const { data: defs } = await supabase
    .from("custom_field_definitions")
    .select("key, label")
    .eq("entity_type", DRIVER_ENTITY_TYPE)
    .eq("is_active", true)
    .is("archived_at", null)
    .order("sort_order", { ascending: true });

  const customHeaders = (defs ?? []).map((d) => d.label || d.key);
  const customSample = (defs ?? []).map(() => "");

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    [...DRIVER_IMPORT_HEADERS, ...customHeaders],
    [...DRIVER_IMPORT_SAMPLE_ROW, ...customSample],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Drivers");
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
