import { NextResponse } from "next/server";
import { commitOrderRecon, type ReconPreview } from "@/features/order-recon/order-recon-actions";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const preview = (await request.json()) as ReconPreview;
    const result = await commitOrderRecon(preview);
    const status = "error" in result && result.error === "not_authorized" ? 401 : 200;
    return NextResponse.json(result, { status });
  } catch {
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}
