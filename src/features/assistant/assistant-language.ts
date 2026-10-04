import { looksArabic } from "./assistant-refuse";

/** The two languages the assistant answers in — the panel's locales. */
export type AssistantLocale = "en" | "ar";

export function isAssistantLocale(value: unknown): value is AssistantLocale {
  return value === "ar" || value === "en";
}

/**
 * QA #2 — the assistant answers in the language the operator asked in, not the
 * language the panel chrome happens to be in.
 *
 * Arabic text pins an Arabic answer (and an Arabic refusal — the copy travels
 * with the answer), Latin text pins English, and a message with no letters at
 * all — a follow-up that is nothing but a code or a number — keeps whatever
 * language the conversation is already using, because there is nothing in it to
 * detect from. `looksArabic` is the single detector, shared with the summary
 * strip, so the two cannot disagree about what counts as Arabic.
 */
export function responseLocaleFor(
  text: string,
  fallback: AssistantLocale,
): AssistantLocale {
  if (looksArabic(text)) return "ar";
  if (/[A-Za-z]/.test(text)) return "en";
  return fallback;
}

/**
 * The one instruction that pins the answer's language, kept here rather than
 * inline in the prompt so the route, the prompt and the tests cannot drift on
 * what the model is told. The second half travels with it on purpose: a
 * translated tool name or a localised code is an answer that can no longer be
 * checked against the tool JSON it cites, so identifiers and figures stay in
 * the form they were returned in whatever language the prose is in.
 */
export const ASSISTANT_LANGUAGE_DIRECTIVE: Record<AssistantLocale, string> = {
  en: "Answer in English. Keep tool names, statuses, codes, IDs, numbers and dates exactly as the tools returned them (Latin script and digits) — never translate, transliterate or localise them.",
  ar: "أجب بالعربية. أبقِ أسماء الأدوات والحالات والرموز والمعرّفات والأرقام والتواريخ كما أعادتها الأدوات (بالحروف اللاتينية والأرقام) — لا تترجمها ولا تنقلها حرفياً ولا تعرّبها.",
};
