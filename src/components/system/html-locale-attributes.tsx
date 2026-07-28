"use client";

import { useEffect } from "react";

/** Sets lang/dir/theme on <html> — root layout owns the single <html> element. */
export function HtmlLocaleAttributes({
  locale,
  themeId,
  fontFamily,
}: {
  locale: string;
  themeId?: string;
  fontFamily?: string;
}) {
  useEffect(() => {
    const html = document.documentElement;
    html.lang = locale;
    html.dir = locale === "ar" ? "rtl" : "ltr";
    if (themeId) html.dataset.theme = themeId;
    if (fontFamily) html.dataset.font = fontFamily;
  }, [locale, themeId, fontFamily]);

  return null;
}
