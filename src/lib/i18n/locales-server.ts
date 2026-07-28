import { readFile } from "fs/promises";
import path from "path";
import {
  flattenMessages,
  countMissingKeys,
  type JsonObject,
} from "@/lib/i18n/message-keys";
import { routing } from "@/i18n/routing";

export type LocaleRow = {
  code: string;
  name: string;
  native_name: string;
  dir: "ltr" | "rtl";
  enabled: boolean;
  is_default: boolean;
  translation_count: number;
  needs_review_count: number;
};

async function loadMessageFile(locale: string) {
  const filePath = path.join(process.cwd(), "src/messages", `${locale}.json`);
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

export async function getTranslationStatsForLocale(
  locale: string,
): Promise<{ total: number; needsReview: number }> {
  const sourceFlat = flattenMessages((await loadMessageFile("en")) as JsonObject);
  if (locale === "en") {
    return { total: Object.keys(sourceFlat).length, needsReview: 0 };
  }
  try {
    const targetFlat = flattenMessages((await loadMessageFile(locale)) as JsonObject);
    return {
      total: Object.keys(sourceFlat).length,
      needsReview: countMissingKeys(sourceFlat, targetFlat),
    };
  } catch {
    return { total: Object.keys(sourceFlat).length, needsReview: Object.keys(sourceFlat).length };
  }
}

export async function loadLocaleMessages(locale: string) {
  return loadMessageFile(locale);
}

export function getSupportedLocaleCodes(): string[] {
  return [...routing.locales];
}
