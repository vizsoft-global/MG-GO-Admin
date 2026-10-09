"use server";

import { getSessionUser } from "@/lib/auth/get-session";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";

export async function updateProfile(
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const fullName = String(formData.get("fullName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!fullName) {
    return { error: "missing_name" };
  }

  const session = await getSessionUser();
  if (!session) {
    return { error: "not_authenticated" };
  }

  const db = await staffDb();
  if (!db) return { error: "save_failed" };

  try {
    await db.collection(COLLECTIONS.profiles).doc(session.id).set(
      {
        full_name: fullName,
        phone: phone || null,
        updated_at: new Date(),
      },
      { merge: true },
    );
  } catch {
    return { error: "save_failed" };
  }

  return { success: true };
}
