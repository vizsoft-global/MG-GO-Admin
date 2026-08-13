import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { getObjectBytes } from "@/lib/storage/r2-client";
import {
  contentDispositionAttachment,
  isDeliveryProofObjectKey,
  proofFilenameFromKey,
} from "@/lib/storage/order-proof-url";
import { guessProofContentType } from "@/lib/storage/proof-image-url";

export async function GET(request: Request) {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "deliveries.view", session.isSuperAdmin)
  ) {
    return NextResponse.json({ error: "not_authorized" }, { status: 403 });
  }

  const key = new URL(request.url).searchParams.get("key")?.trim() ?? "";
  if (!isDeliveryProofObjectKey(key)) {
    return NextResponse.json({ error: "invalid_key" }, { status: 400 });
  }

  let object: Awaited<ReturnType<typeof getObjectBytes>>;
  try {
    object = await getObjectBytes(key);
  } catch {
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }
  if (!object) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const filename = proofFilenameFromKey(key) ?? "proof.jpg";
  const contentType =
    object.contentType ?? guessProofContentType(key) ?? "application/octet-stream";

  return new NextResponse(Buffer.from(object.bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": contentDispositionAttachment(filename),
      "Cache-Control": "private, no-store",
    },
  });
}
