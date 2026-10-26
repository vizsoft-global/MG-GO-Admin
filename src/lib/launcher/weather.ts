export const KUWAIT_FORECAST_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=29.3759&longitude=47.9774&current=temperature_2m,weather_code,is_day&timezone=Asia/Kuwait";

export const WEATHER_REFRESH_MS = 30 * 60 * 1000;

export type WeatherKind = "clear" | "cloud" | "fog" | "rain" | "snow" | "storm";

export type LauncherWeather = {
  tempC: number | null;
  code: number | null;
  isDay: boolean;
};

export function weatherKind(code: number): WeatherKind {
  if (code === 0) return "clear";
  if (code >= 1 && code <= 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "cloud";
}

export function formatTempC(celsius: number): string {
  return `${Math.round(celsius)}°c`;
}

export function parseOpenMeteo(body: unknown): LauncherWeather {
  const current =
    body && typeof body === "object" && "current" in body
      ? (body as { current?: unknown }).current
      : null;
  if (!current || typeof current !== "object") {
    return { tempC: null, code: null, isDay: true };
  }
  const row = current as {
    temperature_2m?: unknown;
    weather_code?: unknown;
    is_day?: unknown;
  };
  const tempC = typeof row.temperature_2m === "number" ? row.temperature_2m : null;
  const code = typeof row.weather_code === "number" ? row.weather_code : null;
  const isDay =
    tempC == null && code == null ? true : row.is_day === 1 || row.is_day === true;
  return { tempC, code, isDay };
}

export function readLauncherWeather(body: unknown): LauncherWeather | null {
  if (!body || typeof body !== "object") return null;
  if (!("tempC" in body) && !("code" in body)) return null;
  const row = body as { tempC?: unknown; code?: unknown; isDay?: unknown };
  return {
    tempC: typeof row.tempC === "number" ? row.tempC : null,
    code: typeof row.code === "number" ? row.code : null,
    isDay: row.isDay !== false,
  };
}
