"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/auth-context";
import { useSidebarMenu } from "@/hooks/use-sidebar-menu";
import { useNavBadges } from "@/hooks/use-nav-badges";
import { Link } from "@/i18n/navigation";
import { signOut } from "@/features/auth/actions";
import { launcherFontClassName } from "@/lib/fonts/app-fonts";
import { kuwaitClock } from "@/lib/launcher/kuwait-clock";
import {
  formatTempC,
  readLauncherWeather,
  WEATHER_REFRESH_MS,
  weatherKind,
  type LauncherWeather,
  type WeatherKind,
} from "@/lib/launcher/weather";
import {
  filterLauncherTiles,
  greetingBucket,
  kuwaitHour,
  LAUNCHER_LABEL_OVERRIDE,
  LAUNCHER_RELEASE,
  launcherTilesFromMenu,
  mergeLauncherTiles,
  type LauncherTile,
  type LauncherTileId,
  visibleLauncherTiles,
} from "@/lib/menu/launcher-modules";
import { launcherGlyphPath, launcherGlyphSrc } from "@/lib/menu/launcher-glyphs";
import { APP_NAV_KEY_BY_ID, resolveIcon } from "@/lib/menu/menu-registry";
import { LAUNCHER_BRAND } from "@/lib/menu/module-colors";
import type { Permission } from "@/lib/auth/permissions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const EMPTY_WEATHER: LauncherWeather = { tempC: null, code: null, isDay: true };

function formatAdminRole(slug: string): string {
  if (!slug) return "";
  return slug
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function LauncherGlyph({ id, icon }: { id: string; icon: string }) {
  const src = launcherGlyphSrc(id);
  if (src) {
    return <img src={src} alt="" width={30} height={30} />;
  }
  const path = launcherGlyphPath(id);
  if (path) {
    return (
      <svg
        width={30}
        height={30}
        viewBox="0 0 24 24"
        fill="none"
        stroke="#2b2b48"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d={path} />
      </svg>
    );
  }
  const Icon = resolveIcon(icon);
  return <Icon className="size-[30px] text-[#2b2b48]" strokeWidth={1.8} aria-hidden />;
}

function SkyGlyph({ kind }: { kind: WeatherKind }) {
  const stroke = "#D9D2CF";
  switch (kind) {
    case "clear":
      return (
        <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M16 14a5 5 0 1 0-4-8 4 4 0 1 0-4 8h8z" stroke={stroke} strokeWidth={1.6} />
        </svg>
      );
    case "cloud":
    case "fog":
      return (
        <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M7 17h10a4 4 0 0 0 0-8 5 5 0 0 0-9.5-1A3.5 3.5 0 0 0 7 17z" stroke={stroke} strokeWidth={1.6} />
          {kind === "fog" ? <path d="M6 20h12" stroke={stroke} strokeWidth={1.6} strokeLinecap="round" /> : null}
        </svg>
      );
    case "rain":
      return (
        <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M7 14h10a4 4 0 0 0 0-8 5 5 0 0 0-9.5-1A3.5 3.5 0 0 0 7 14z" stroke={stroke} strokeWidth={1.6} />
          <path d="M9 17l-1 3M13 17l-1 3M17 17l-1 3" stroke={stroke} strokeWidth={1.6} strokeLinecap="round" />
        </svg>
      );
    case "snow":
      return (
        <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M12 4v16M6 8l12 8M18 8L6 16" stroke={stroke} strokeWidth={1.6} strokeLinecap="round" />
        </svg>
      );
    case "storm":
      return (
        <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M7 13h10a4 4 0 0 0 0-8 5 5 0 0 0-9.5-1A3.5 3.5 0 0 0 7 13z" stroke={stroke} strokeWidth={1.6} />
          <path d="M13 14l-3 5h3l-1 4 5-6h-3l2-3z" fill={stroke} />
        </svg>
      );
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

function WeatherGlyph({ weather }: { weather: LauncherWeather }) {
  const kind = weather.code == null ? "clear" : weatherKind(weather.code);
  if (kind === "clear" && weather.isDay) {
    return <img src="/launcher/v5/sun.svg" alt="" width={24} height={24} />;
  }
  return <SkyGlyph kind={kind} />;
}

export function AppLauncherShell() {
  const t = useTranslations("pages.launcher");
  const tNav = useTranslations();
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { fullName, email, permissions, isSuperAdmin, adminRoleSlug } = useAuth();
  const badges = useNavBadges();
  const { tree } = useSidebarMenu();
  const [query, setQuery] = useState("");
  const [now, setNow] = useState<Date | null>(null);
  const [weather, setWeather] = useState<LauncherWeather>(EMPTY_WEATHER);
  const searchRef = useRef<HTMLInputElement>(null);
  const hour = kuwaitHour(now ?? undefined);
  const greeting = greetingBucket(hour);
  const clock = now ? kuwaitClock(now, locale) : null;

  const tiles = useMemo(
    () =>
      mergeLauncherTiles(
        launcherTilesFromMenu(tree),
        visibleLauncherTiles(permissions as Permission[], isSuperAdmin),
      ),
    [tree, permissions, isSuperAdmin],
  );

  const labels = useMemo(() => {
    const map = new Map<string, string>();
    const translate = (key: string): string | null => (tNav.has(key) ? tNav(key) : null);
    for (const item of tiles) {
      const override =
        locale === "ar" ? undefined : LAUNCHER_LABEL_OVERRIDE[item.id as LauncherTileId];
      const navKey = APP_NAV_KEY_BY_ID[item.id];
      if (override) {
        map.set(item.id, override);
        continue;
      }
      const fromNav = navKey
        ? translate(item.id.startsWith("group-") ? `appNavGroups.${navKey}` : `nav.${navKey}`)
        : null;
      map.set(item.id, fromNav ?? item.label);
    }
    return map;
  }, [tiles, tNav, locale]);

  const visible = useMemo(
    () => filterLauncherTiles(tiles, query, labels),
    [tiles, query, labels],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/launcher/weather");
        if (!response.ok) return;
        const next = readLauncherWeather(await response.json());
        if (!cancelled && next) setWeather(next);
      } catch {
        /* keep the last reading */
      }
    }
    void load();
    const id = window.setInterval(() => void load(), WEATHER_REFRESH_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const displayName = (fullName ?? "").trim() || t("colleague");
  const initials = (fullName ?? email ?? "A").slice(0, 2).toUpperCase();
  const roleLabel = formatAdminRole(adminRoleSlug);

  const renderTile = (item: LauncherTile) => {
    const badge = badges[item.id];
    return (
      <Link
        key={item.id}
        href={item.href}
        className="group/hub flex w-[90px] flex-col items-center text-center"
      >
        <span
          className="relative grid size-16 place-items-center overflow-visible rounded-2xl border border-black/15"
          style={{
            backgroundColor: LAUNCHER_BRAND.tile,
            backgroundImage: "linear-gradient(180deg, transparent, rgba(0,0,0,0.15))",
            boxShadow: "0 3px 10px rgba(0,0,0,0.2)",
          }}
        >
          <span className="inline-grid origin-center transition-transform duration-200 ease-[var(--ease-out)] motion-reduce:transition-none motion-reduce:group-hover/hub:scale-100 [@media(hover:hover)_and_(pointer:fine)]:group-hover/hub:scale-[1.4]">
            <LauncherGlyph id={item.id} icon={item.icon} />
          </span>
          {badge ? (
            <span
              className="absolute -end-1.5 -top-1.5 z-10 inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums text-white"
              style={{
                backgroundColor: LAUNCHER_BRAND.badge,
                border: `2px solid ${LAUNCHER_BRAND.badgeBorder}`,
              }}
            >
              {badge > 999 ? "999+" : badge}
            </span>
          ) : null}
        </span>
        <span className="mt-2.5 text-[13px] leading-tight font-medium text-white">
          {labels.get(item.id) ?? item.label}
        </span>
      </Link>
    );
  };

  return (
    <div
      className={`${launcherFontClassName} relative flex h-full min-h-0 flex-col overflow-hidden`}
      style={{
        backgroundColor: LAUNCHER_BRAND.canvas,
        color: LAUNCHER_BRAND.text,
        fontFamily: '"Gotham", "GE SS TWO", "Noto Sans Arabic", sans-serif',
      }}
    >
      <header
        className="relative z-20 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-white/10 px-6 md:px-10"
        style={{
          backgroundColor: LAUNCHER_BRAND.topBar,
          boxShadow: "0 5px 100px rgba(0,0,0,0.25)",
        }}
      >
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5">
          <span
            className="grid size-7 place-items-center overflow-hidden rounded-lg"
            style={{ backgroundColor: LAUNCHER_BRAND.logoChip }}
          >
            <img src="/launcher-mark.png" alt="" className="size-5 object-contain" />
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="text-[13px] font-medium text-white">{t("wordmark")}</span>
            <span className="text-[11px]" style={{ color: LAUNCHER_BRAND.muted }}>
              {t("panel")}
            </span>
          </span>
        </Link>

        <label
          className="relative flex h-9 min-w-0 max-w-[440px] flex-1 items-center gap-2 rounded-xl px-3"
          style={{
            backgroundColor: LAUNCHER_BRAND.search,
            border: `1.2px solid ${LAUNCHER_BRAND.searchBorder}`,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" aria-hidden>
            <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" />
          </svg>
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-9 w-full flex-1 border-0 bg-transparent p-0 text-[13px] text-white shadow-none placeholder:text-white/50 focus-visible:border-0 focus-visible:ring-0"
          />
          <kbd
            className="hidden shrink-0 rounded px-1.5 py-px text-[11px] text-white sm:inline"
            style={{
              backgroundColor: LAUNCHER_BRAND.searchHint,
              border: "0.7px solid rgba(255,255,255,0.15)",
            }}
          >
            {t("searchHint")}
          </kbd>
        </label>

        <div className="flex shrink-0 items-center gap-2.5">
          <Link
            href="/notifications"
            className="grid size-[35px] place-items-center rounded-full text-white"
            style={{ backgroundColor: LAUNCHER_BRAND.search }}
            aria-label={tNav("nav.notifications")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4" />
            </svg>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex h-9 cursor-pointer items-center gap-2 rounded-full py-1 ps-1 pe-2.5"
              style={{ backgroundColor: LAUNCHER_BRAND.search }}
            >
              <span
                className="grid size-7 place-items-center rounded-full text-[11px] font-medium text-white"
                style={{ backgroundColor: LAUNCHER_BRAND.accent }}
              >
                {initials}
              </span>
              <span className="hidden max-w-[120px] truncate text-[12px] text-white lg:block">
                {roleLabel || displayName}
              </span>
              <ChevronDown className="size-3.5 text-white" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm font-medium">{fullName ?? "Admin"}</p>
                    <p className="text-xs text-muted-foreground">{email}</p>
                  </div>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="cursor-pointer" render={<Link href="/settings" />}>
                {tCommon("settings")}
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer" onClick={() => signOut(locale)}>
                {tCommon("logout")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 flex-col overflow-auto px-4 pt-8 pb-4">
        <div className="mx-auto flex w-full max-w-[754px] items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 ps-1">
            <img src="/launcher/v5/mark.svg" alt="" width={38} height={44} />
            <div className="min-w-0">
              <p className="m-0 text-[13px]" style={{ color: LAUNCHER_BRAND.subText }}>
                {t(`greeting.${greeting}`)},
              </p>
              <p className="m-0 truncate text-2xl font-bold text-white">{displayName}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-4 text-white">
            <div className="flex items-center gap-2">
              <WeatherGlyph weather={weather} />
              <span className="flex flex-col leading-tight">
                <span className="text-sm font-semibold" style={{ color: LAUNCHER_BRAND.meta }}>
                  {weather.tempC == null ? "—" : formatTempC(weather.tempC)}
                </span>
                <span className="text-[10px]" style={{ color: "rgba(217,210,207,0.6)" }}>
                  {t("weatherCity")}
                </span>
              </span>
            </div>
            <span className="h-5 w-px bg-white/20" aria-hidden />
            <div className="flex items-center gap-2">
              <img src="/launcher/v5/calendar.svg" alt="" width={20} height={20} />
              <span className="flex flex-col leading-tight">
                <span className="text-sm font-semibold" style={{ color: LAUNCHER_BRAND.meta }}>
                  {clock ? `${clock.weekday}, ${clock.dayLabel}` : "—"}
                </span>
                <span className="text-[10px]" style={{ color: "rgba(217,210,207,0.6)" }}>
                  {clock?.month ?? ""}
                </span>
              </span>
            </div>
            <span className="h-5 w-px bg-white/20" aria-hidden />
            <div className="flex items-center gap-2">
              <img src="/launcher/v5/clock.svg" alt="" width={20} height={20} />
              <span className="text-sm font-semibold" style={{ color: LAUNCHER_BRAND.meta }}>
                {clock?.time ?? "—"}
              </span>
            </div>
          </div>
        </div>

        <nav
          aria-label={t("title")}
          className="mx-auto mt-8 w-full max-w-[754px] rounded-[32px] border border-white/15 bg-white/5 p-[25px] shadow-[0_11px_50px_rgba(5,5,18,0.2)]"
        >
          <div className="flex flex-wrap justify-center gap-x-[30px] gap-y-[15px]">
            {visible.map(renderTile)}
          </div>
        </nav>
      </main>

      <footer
        className="relative z-10 shrink-0 px-4 py-2 text-center"
        style={{
          backgroundColor: LAUNCHER_BRAND.footerBar,
          boxShadow: "0 -5px 50px rgba(0,0,0,0.25)",
        }}
      >
        <img src="/launcher-mark.png" alt="" className="mx-auto mb-1 h-[30px] w-auto brightness-0 invert" />
        <p className="m-0 text-[10px]" style={{ color: LAUNCHER_BRAND.footer }}>
          {t("footer", {
            name: t("wordmark"),
            subtitle: t("panel"),
            version: LAUNCHER_RELEASE,
          })}{" "}
          <span className="font-semibold text-white">{t("company")}</span>
        </p>
      </footer>
      <img
        src="/launcher-mg-watermark.png"
        alt=""
        aria-hidden
        className="pointer-events-none absolute -end-6 -bottom-16 z-0 w-[420px] opacity-25"
      />
    </div>
  );
}
