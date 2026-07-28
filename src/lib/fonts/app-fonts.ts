import {
  DM_Sans,
  Inter,
  Open_Sans,
  Plus_Jakarta_Sans,
  Roboto,
} from "next/font/google";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const roboto = Roboto({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "700"],
  variable: "--font-roboto",
  display: "swap",
});

const openSans = Open_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-open-sans",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plus-jakarta-sans",
  display: "swap",
});

export const appFontClassName = [
  inter.variable,
  roboto.variable,
  openSans.variable,
  dmSans.variable,
  plusJakarta.variable,
].join(" ");
