import { NextResponse } from "next/server";
import { fetchDeliveryGpsAudit } from "@/features/deliveries/deliveries-actions";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  try {
    const result = await fetchDeliveryGpsAudit(id);
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "not_authorized") {
      return NextResponse.json({ error: "not_authorized" }, { status: 403 });
    }
    console.error("[api/deliveries/gps]", err);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
