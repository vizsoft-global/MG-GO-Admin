import { NextResponse } from "next/server";
import { undoOrderReconImport } from "@/features/order-recon/order-recon-actions";

export const maxDuration = 300;

export async function POST() {
  try {
    const result = await undoOrderReconImport();
    const status = result.error === "not_authorized" ? 401 : 200;
    return NextResponse.json(result, { status });
  } catch {
    return NextResponse.json({ error: "request_failed" }, { status: 500 });
  }
}
