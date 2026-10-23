import { getFirestore } from "../core/fs";
import { COLLECTIONS } from "./collections";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Catalog labels for `nationality_category_keys`. English is the stable slicer value. */
export async function loadNationalityLabels(locale: "en" | "ar"): Promise<Map<string, string>> {
  const snap = await getFirestore().collection(COLLECTIONS.nationalityCategories).get();
  const map = new Map<string, string>();
  snap.forEach((doc) => {
    const data = doc.data();
    const key = text(data.key) || doc.id;
    const en = text(data.label_en);
    const ar = text(data.label_ar);
    map.set(key, locale === "ar" ? ar || en || key : en || ar || key);
  });
  return map;
}

/**
 * The name an operator should see. The category catalog wins. A rider filed
 * before that catalog existed still shows the stored ISO code.
 */
export function nationalityLabel(
  categoryKeys: unknown,
  labels: Map<string, string>,
  storedCountry: string | null,
): string | null {
  const keys = Array.isArray(categoryKeys)
    ? categoryKeys.map((item) => text(item)).filter(Boolean)
    : [];
  if (keys.length > 0) return keys.map((key) => labels.get(key) || key).join(", ");
  const country = text(storedCountry);
  return country || null;
}
