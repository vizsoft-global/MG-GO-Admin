"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  LAUNCHER_HOME_TILE_IDS,
  LAUNCHER_LABEL_OVERRIDE,
  LAUNCHER_RELEASE,
  launcherTilesFromMenu,
  mergeLauncherTiles,
  type LauncherTile,
  type LauncherTileId,
  visibleLauncherTiles,
} from "@/lib/menu/launcher-modules";
import { launcherGlyphSrc } from "@/lib/menu/launcher-glyphs";
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

/** Same names the sidebar treats as stale, so a saved menu label can win. */
const SUPERSEDED_NAV_LABELS = new Set([
  "Drivers",
  "Request & Complaint",
  "Requests & Complaints",
  "EmployeeDesk",
  "السائقون",
  "مكتب الموظفين",
  "مكتب الموظف",
]);

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
  const Icon = resolveIcon(icon);
  return (
    <Icon
      className="size-[30px] fill-[#27273F] text-[#27273F]"
      strokeWidth={2.2}
      aria-hidden
    />
  );
}

function SkyGlyph({ kind }: { kind: WeatherKind }) {
  const fill = "#D9D2CF";
  switch (kind) {
    case "clear":
      return (
        <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden>
          <path fill={fill} d="M16 14a5 5 0 1 0-4-8 4 4 0 1 0-4 8h8z" />
        </svg>
      );
    case "cloud":
    case "fog":
      return (
        <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden>
          <path fill={fill} d="M7 17h10a4 4 0 0 0 .4-8 5 5 0 0 0-9.6-1.2A3.5 3.5 0 0 0 7 17z" />
          {kind === "fog" ? <path fill={fill} d="M6 19h12v1.6H6z" /> : null}
        </svg>
      );
    case "rain":
      return (
        <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden>
          <path fill={fill} d="M7 14h10a4 4 0 0 0 .4-8 5 5 0 0 0-9.6-1.2A3.5 3.5 0 0 0 7 14z" />
          <path fill={fill} d="M8.2 16h1.6l-1 4H7.2zm4 0h1.6l-1 4h-1.6zm4 0h1.6l-1 4h-1.6z" />
        </svg>
      );
    case "snow":
      return (
        <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden>
          <path fill={fill} d="M11 3h2v18h-2zM4.6 7.2l1.4-1.4 12.8 12.8-1.4 1.4zM19.4 7.2l-1.4-1.4L5.2 18.6l1.4 1.4z" />
        </svg>
      );
    case "storm":
      return (
        <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden>
          <path fill={fill} d="M7 13h10a4 4 0 0 0 .4-8 5 5 0 0 0-9.6-1.2A3.5 3.5 0 0 0 7 13z" />
          <path fill={fill} d="M13 14l-3 5h3l-1 4 5-6h-3l2-3z" />
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

export function AppLauncherShell({
  badgeOverrides,
}: {
  badgeOverrides?: Record<string, number>;
} = {}) {
  const t = useTranslations("pages.launcher");
  const tNav = useTranslations();
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { fullName, email, permissions, isSuperAdmin, adminRoleSlug } = useAuth();
  const liveBadges = useNavBadges();
  const badges = badgeOverrides ? { ...liveBadges, ...badgeOverrides } : liveBadges;
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
      if (item.id === "live-tracking-v2") {
        map.set(item.id, translate("nav.liveTracking") ?? item.label);
        continue;
      }
      const sidebarHub = (LAUNCHER_HOME_TILE_IDS as readonly string[]).includes(item.id);
      const override =
        locale === "ar" || sidebarHub
          ? undefined
          : LAUNCHER_LABEL_OVERRIDE[item.id as LauncherTileId];
      const navKey = APP_NAV_KEY_BY_ID[item.id];
      if (override) {
        map.set(item.id, override);
        continue;
      }
      const fromNav = navKey
        ? translate(item.id.startsWith("group-") ? `appNavGroups.${navKey}` : `nav.${navKey}`)
        : null;
      const saved = item.label?.trim();
      const useSaved =
        sidebarHub &&
        saved &&
        saved !== fromNav &&
        saved !== navKey &&
        !SUPERSEDED_NAV_LABELS.has(saved);
      map.set(item.id, (useSaved ? saved : fromNav) ?? saved ?? item.id);
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
        className="group/hub flex w-[90px] flex-col items-center gap-[10px] text-center"
      >
        <span
          className="relative grid size-16 place-items-center overflow-visible rounded-2xl border-[0.7px] border-black/15 shadow-[0_3px_10px_rgba(0,0,0,0.2)] transition-[transform,box-shadow] duration-200 ease-[var(--ease-out)] motion-reduce:transition-none motion-reduce:group-hover/hub:[transform:none] motion-reduce:group-hover/hub:shadow-[0_3px_10px_rgba(0,0,0,0.2)] [@media(hover:hover)_and_(pointer:fine)]:group-hover/hub:[transform:translateY(-1.5px)_scale(1.024)] [@media(hover:hover)_and_(pointer:fine)]:group-hover/hub:shadow-[0_12px_26px_rgba(0,0,0,0.42)]"
          style={{
            backgroundColor: LAUNCHER_BRAND.tile,
            backgroundImage: "linear-gradient(180deg, transparent, rgba(0,0,0,0.15))",
          }}
        >
          <span className="inline-grid origin-center">
            <LauncherGlyph id={item.id} icon={item.icon} />
          </span>
          {badge ? (
            <span
              className="absolute -end-1 -top-1 z-10 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] leading-none font-semibold tabular-nums text-white"
              style={{ backgroundColor: LAUNCHER_BRAND.accent }}
            >
              {badge > 999 ? "999+" : badge}
            </span>
          ) : null}
        </span>
        <span className="text-[13px] leading-normal font-medium text-white">
          {labels.get(item.id) ?? item.label}
        </span>
      </Link>
    );
  };

  return (
    <div
      className={`${launcherFontClassName} fixed inset-0 flex flex-col overflow-hidden`}
      style={{
        backgroundColor: LAUNCHER_BRAND.canvas,
        color: LAUNCHER_BRAND.text,
        fontFamily: '"Gotham", "GE SS TWO", "Noto Sans Arabic", sans-serif',
      }}
    >
      <header
        className="relative z-20 flex h-16 shrink-0 items-center justify-center border-b-[0.7px] border-white/10 px-4 sm:px-10"
        style={{
          backgroundColor: LAUNCHER_BRAND.topBar,
          boxShadow: "0 5px 100px rgba(0,0,0,0.25)",
        }}
      >
        <Link href="/dashboard" className="absolute start-4 flex shrink-0 items-center gap-2.5 sm:start-10">
          <span
            className="grid size-7 place-items-center overflow-hidden rounded-lg"
            style={{ backgroundColor: LAUNCHER_BRAND.logoChip }}
          >
            <img src="/launcher/v5/header-mark.svg" alt="" width={18} height={18} />
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="text-[13px] font-medium text-white">{t("wordmark")}</span>
            <span className="text-[11px]" style={{ color: LAUNCHER_BRAND.muted }}>
              {t("panel")}
            </span>
          </span>
        </Link>

        <label
          className="flex h-[38px] w-[min(440px,calc(100%-18rem))] items-center gap-2 rounded-xl px-3"
          style={{
            backgroundColor: LAUNCHER_BRAND.search,
            border: `1.2px solid ${LAUNCHER_BRAND.searchBorder}`,
          }}
        >
          <img src="/launcher/v5/search.svg" alt="" width={16} height={16} />
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-8 w-full flex-1 border-0 bg-transparent! p-0 text-[13px] text-white shadow-none placeholder:text-white/50 focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent!"
            style={{ backgroundColor: LAUNCHER_BRAND.search, border: 0, boxShadow: "none" }}
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

        <div className="absolute end-4 flex shrink-0 items-center gap-2.5 sm:end-10">
          <Link
            href="/notifications"
            className="grid size-[35px] place-items-center rounded-full border-[0.7px] border-black/15 text-white"
            style={{ backgroundColor: LAUNCHER_BRAND.search }}
            aria-label={tNav("nav.notifications")}
          >
            <img src="/launcher/v5/bell.svg" alt="" width={18} height={18} />
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
              <img src="/launcher/v5/chevron.svg" alt="" width={14} height={14} />
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

      <main className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center overflow-auto px-4 py-6">
        <div className="flex w-full max-w-[754px] items-center justify-between gap-[15px]">
          <div className="flex items-center gap-2.5 ps-1">
            <img
              src="/launcher/v5/mark.svg?v=3"
              alt=""
              width={38}
              height={44}
              className="shrink-0 -scale-y-100"
            />
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
              <img src="/launcher/v5/calendar.svg" alt="" width={24} height={24} />
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
              <img src="/launcher/v5/clock.svg" alt="" width={24} height={24} />
              <span className="text-sm font-semibold" style={{ color: LAUNCHER_BRAND.meta }}>
                {clock?.time ?? "—"}
              </span>
            </div>
          </div>
        </div>

        <nav
          aria-label={t("title")}
          className="mt-[77px] w-full max-w-[754px] rounded-[32px] border-[0.7px] border-white/15 bg-white/5 p-[25px] shadow-[0_11px_50px_rgba(5,5,18,0.2)]"
        >
          <div className="flex flex-wrap justify-center gap-x-[30px] gap-y-[15px]">
            {visible.map(renderTile)}
          </div>
        </nav>
      </main>

        <div className="relative z-10 mt-auto flex w-full shrink-0 flex-col items-center">
          <img
            src="/launcher/v5/footer-mark.svg?v=3"
            alt=""
            width={64}
            height={30}
            className="mb-5 block h-[30px] w-16 -scale-y-100 object-contain"
          />
          <footer
            className="flex h-8 w-full items-center justify-center px-4 text-center"
            style={{
              backgroundColor: LAUNCHER_BRAND.footerBar,
              boxShadow: "0 -5px 50px rgba(0,0,0,0.25)",
            }}
          >
            <p className="m-0 text-[10px]" style={{ color: LAUNCHER_BRAND.footer }}>
              {t("footer", {
                name: t("wordmark"),
                subtitle: t("panel"),
                version: LAUNCHER_RELEASE,
              })}{" "}
              <span className="font-semibold text-white">{t("company")}</span>
            </p>
          </footer>
        </div>
      <img
        src="/launcher/v5/watermark.svg?v=3"
        alt=""
        aria-hidden
        className="pointer-events-none absolute end-0 bottom-10 z-0 w-[264px] -scale-y-100 opacity-30"
      />
    </div>
  );
}
