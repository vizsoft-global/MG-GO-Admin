import { NextResponse } from "next/server";
import { commitOrderRecon } from "@/features/order-recon/order-recon-actions";
import type { ReconCommitPayload } from "@/features/order-recon/order-recon-resolve";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const preview = (await request.json()) as ReconCommitPayload;
    const result = await commitOrderRecon(preview);
    const status = "error" in result && result.error === "not_authorized" ? 401 : 200;
    return NextResponse.json(result, { status });
  } catch {
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}
