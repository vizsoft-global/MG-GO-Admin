import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";

async function requireSuperAdmin() {
  const session = await getSessionUser();
  if (!session) throw new Error("Unauthorized");
  if (!session.isSuperAdmin) throw new Error("Forbidden");
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    const body = (await request.json()) as {
      enabled?: boolean;
      is_default?: boolean;
    };
    await requireSuperAdmin();

    const db = await staffDb();
    if (!db) return NextResponse.json({ error: "not_configured" }, { status: 500 });

    const snap = await db.collection(COLLECTIONS.locales).get();
    const target = snap.docs.find((doc) => doc.id === code || doc.data().code === code);
    if (!target) return NextResponse.json({ error: "locale_not_found" }, { status: 500 });

    const batch = db.batch();
    if (body.is_default) {
      for (const doc of snap.docs) {
        if (doc.id === target.id) continue;
        if (doc.data().is_default === true) {
          batch.set(doc.ref, { is_default: false, updated_at: new Date() }, { merge: true });
        }
      }
    }

    const patch: {
      updated_at: Date;
      enabled?: boolean;
      is_default?: boolean;
    } = { updated_at: new Date() };
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (body.is_default) patch.is_default = true;
    batch.set(target.ref, patch, { merge: true });
    await batch.commit();

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    const status = msg === "Unauthorized" || msg === "Forbidden" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
