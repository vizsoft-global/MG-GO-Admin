import { NextResponse } from "next/server";
import { getSignedStorageUrl } from "@/lib/storage/storage-actions";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");

  if (!key) {
    return NextResponse.json({ error: "missing_key" }, { status: 400 });
  }

  const result = await getSignedStorageUrl(key);

  if (result.error === "not_authorized") {
    return NextResponse.json({ error: result.error }, { status: 403 });
  }
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ url: result.url });
}
