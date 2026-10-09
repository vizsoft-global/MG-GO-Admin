import { NextResponse } from "next/server";
import type { DocumentData } from "firebase-admin/firestore";
import { getSessionUser } from "@/lib/auth/get-session";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { getTranslationStatsForLocale } from "@/lib/i18n/locales-server";

function iso(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

function plainRow(id: string, data: DocumentData): Record<string, unknown> {
  const row: Record<string, unknown> = { id };
  for (const [key, value] of Object.entries(data)) {
    const asIso = iso(value);
    row[key] = asIso ?? value;
  }
  if (typeof row.code !== "string") row.code = id;
  return row;
}

async function requireSuperAdmin() {
  const session = await getSessionUser();
  if (!session) throw new Error("Unauthorized");
  if (!session.isSuperAdmin) throw new Error("Forbidden");
}

export async function GET() {
  try {
    await requireSuperAdmin();
    const db = await staffDb();
    if (!db) return NextResponse.json({ error: "not_configured" }, { status: 500 });

    const snap = await db.collection(COLLECTIONS.locales).get();
    const rows = snap.docs
      .map((doc) => plainRow(doc.id, doc.data()))
      .sort((a, b) => {
        const aDefault = a.is_default === true ? 1 : 0;
        const bDefault = b.is_default === true ? 1 : 0;
        if (aDefault !== bDefault) return bDefault - aDefault;
        return String(a.code ?? "").localeCompare(String(b.code ?? ""));
      });

    const enriched = await Promise.all(
      rows.map(async (locale) => {
        const code = String(locale.code ?? "");
        const stats = await getTranslationStatsForLocale(code);
        return {
          ...locale,
          translation_count: stats.total,
          needs_review_count: stats.needsReview,
        };
      }),
    );

    return NextResponse.json({ locales: enriched });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    const status = msg === "Unauthorized" || msg === "Forbidden" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
