import type { ReactNode } from "react";
import { appFontClassName } from "@/lib/fonts/app-fonts";
import { routing } from "@/i18n/routing";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang={routing.defaultLocale}
      suppressHydrationWarning
      className={`${appFontClassName} h-full`}
    >
      <body className="min-h-full font-sans antialiased">{children}</body>
    </html>
  );
}
