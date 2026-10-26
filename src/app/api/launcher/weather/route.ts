import { NextResponse } from "next/server";
import { KUWAIT_FORECAST_URL, parseOpenMeteo } from "@/lib/launcher/weather";

export const revalidate = 1800;

export async function GET() {
  try {
    const response = await fetch(KUWAIT_FORECAST_URL, { next: { revalidate: 1800 } });
    if (!response.ok) return NextResponse.json(parseOpenMeteo(null));
    return NextResponse.json(parseOpenMeteo(await response.json()));
  } catch {
    return NextResponse.json(parseOpenMeteo(null));
  }
}
