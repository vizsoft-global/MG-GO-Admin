import { NextResponse } from "next/server";
import { previewOrderRecon } from "@/features/order-recon/order-recon-actions";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const result = await previewOrderRecon(form);
    const status = "error" in result && result.error === "not_authorized" ? 401 : 200;
    return NextResponse.json(result, { status });
  } catch {
    return NextResponse.json({ error: "preview_failed" }, { status: 500 });
  }
}
