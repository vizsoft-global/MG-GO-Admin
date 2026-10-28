import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { menuIconObjectKey } from "@/lib/menu/menu-icon";
import { getObjectBytes } from "@/lib/storage/r2-client";

export const dynamic = "force-dynamic";

const CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const { file } = await params;
  const key = menuIconObjectKey(file);
  if (!key) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let object: Awaited<ReturnType<typeof getObjectBytes>>;
  try {
    object = await getObjectBytes(key);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!object) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  return new NextResponse(Buffer.from(object.bytes), {
    headers: {
      "content-type": object.contentType ?? CONTENT_TYPE[ext] ?? "application/octet-stream",
      "cache-control": "private, max-age=86400",
    },
  });
}
