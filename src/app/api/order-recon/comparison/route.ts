import { NextResponse } from "next/server";
import { getOrderComparison } from "@/features/order-recon/order-comparison-actions";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { from?: string; to?: string };
    const result = await getOrderComparison({
      from: String(body.from ?? ""),
      to: String(body.to ?? ""),
    });
    const status = "error" in result && result.error === "not_authorized" ? 401 : 200;
    return NextResponse.json(result, { status });
  } catch {
    return NextResponse.json({ error: "request_failed" }, { status: 500 });
  }
}
