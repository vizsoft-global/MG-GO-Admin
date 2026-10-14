"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/auth-context";
import { useBranding } from "@/contexts/branding-context";
import { useNavBadges } from "@/hooks/use-nav-badges";
import { Link } from "@/i18n/navigation";
import { signOut } from "@/features/auth/actions";
import { launcherFontClassName } from "@/lib/fonts/app-fonts";
import {
  filterLauncherTiles,
  greetingBucket,
  kuwaitHour,
  LAUNCHER_LABEL_OVERRIDE,
  type LauncherTileId,
  visibleLauncherTiles,
} from "@/lib/menu/launcher-modules";
import { LAUNCHER_GLYPH } from "@/lib/menu/launcher-glyphs";
import { APP_NAV_KEY_BY_ID } from "@/lib/menu/menu-registry";
import { LAUNCHER_BRAND, launcherTileHex } from "@/lib/menu/module-colors";
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

const TILE_SHADOW =
  "inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -2px 0 rgba(0,0,0,0.10), 0 1px 2px rgba(41,41,63,0.12), 0 8px 18px -6px rgba(41,41,63,0.28)";

function formatAdminRole(slug: string): string {
  if (!slug) return "";
  return slug
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function LauncherGlyph({ id }: { id: LauncherTileId }) {
  return (
    <svg
      width="27"
      height="27"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#ffffff"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={LAUNCHER_GLYPH[id]} />
    </svg>
  );
}

export function AppLauncherShell() {
  const t = useTranslations("pages.launcher");
  const tNav = useTranslations();
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const branding = useBranding();
  const { fullName, email, permissions, isSuperAdmin, adminRoleSlug } = useAuth();
  const badges = useNavBadges();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const hour = kuwaitHour();
  const greeting = greetingBucket(hour);

  const tiles = useMemo(
    () => visibleLauncherTiles(permissions as Permission[], isSuperAdmin),
    [permissions, isSuperAdmin],
  );

  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of tiles) {
      const override = LAUNCHER_LABEL_OVERRIDE[item.id as LauncherTileId];
      const navKey = APP_NAV_KEY_BY_ID[item.id];
      const fromNav = navKey ? tNav(`nav.${navKey}`) : null;
      map.set(item.id, override ?? fromNav ?? item.defaultLabel);
    }
    return map;
  }, [tiles, tNav]);

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

  const displayName = (fullName ?? "").trim() || t("colleague");
  const initials = (fullName ?? email ?? "A").slice(0, 2).toUpperCase();
  const roleLabel = formatAdminRole(adminRoleSlug);

  return (
    <div
      className={`${launcherFontClassName} relative flex h-full min-h-svh flex-col overflow-hidden`}
      style={{
        backgroundColor: LAUNCHER_BRAND.canvas,
        color: LAUNCHER_BRAND.text,
        fontFamily: 'var(--font-launcher), "Noto Sans Arabic", "Segoe UI", sans-serif',
      }}
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 55% at 50% 28%, rgba(255,255,255,0.62) 0%, rgba(249,241,235,0) 68%), radial-gradient(ellipse 46% 38% at 100% 100%, rgba(41,41,63,0.07) 0%, transparent 62%)",
          }}
        />
        <svg
          className="absolute -end-6 -bottom-[40px] w-[min(42vw,420px)] opacity-[0.11]"
          viewBox="0 0 200 200"
          fill="none"
        >
          <path
            d="M28 168V42h46l26 78 26-78h46v126h-32V78l-28 80h-24L60 78v90H28z"
            fill="#29293f"
          />
        </svg>
      </div>
      <header
        className="relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-4 px-6 py-2.5 text-white"
        style={{ backgroundColor: LAUNCHER_BRAND.topBar }}
      >
        <Link href="/dashboard" className="flex shrink-0 items-center gap-[10px]">
          <img
            src="/launcher-mark.png"
            alt={branding.appName}
            className="h-[26px] w-auto"
          />
          <span className="flex min-w-0 flex-col leading-[1.15]">
            <span className="truncate text-[13px] font-bold tracking-[0.04em]">
              {branding.appName}
            </span>
            <span className="truncate text-[11px]" style={{ color: LAUNCHER_BRAND.muted }}>
              {branding.appSubtitle}
            </span>
          </span>
        </Link>

        <label
          className="relative flex min-w-[200px] flex-[0_1_380px] items-center gap-2 rounded-lg px-3 py-[7px]"
          style={{
            backgroundColor: LAUNCHER_BRAND.search,
            border: `1px solid ${LAUNCHER_BRAND.searchBorder}`,
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke={LAUNCHER_BRAND.muted}
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M11 18a7 7 0 1 0 0-14a7 7 0 1 0 0 14z M20 20l-4-4" />
          </svg>
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-auto w-full flex-1 border-0 bg-transparent p-0 text-[13px] text-white shadow-none focus-visible:border-0 focus-visible:ring-0"
          />
          <kbd
            className="hidden shrink-0 rounded px-[5px] py-px text-[11px] sm:inline"
            style={{
              color: LAUNCHER_BRAND.muted,
              border: "1px solid rgba(255,255,255,0.2)",
            }}
          >
            {t("searchHint")}
          </kbd>
        </label>

        <div className="flex shrink-0 items-center gap-3.5">
          <Link
            href="/notifications"
            className="grid size-9 place-items-center rounded-full text-white hover:bg-white/10"
            aria-label={tNav("nav.notifications")}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z M10 21h4" />
            </svg>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex cursor-pointer items-center gap-2 rounded-full pe-1 hover:bg-white/10">
              <span
                className="grid size-[30px] place-items-center rounded-full text-[11px] font-bold text-white"
                style={{ backgroundColor: LAUNCHER_BRAND.accent }}
              >
                {initials}
              </span>
              <span className="hidden max-w-[140px] truncate text-start text-[13px] font-semibold leading-tight lg:block">
                {roleLabel || displayName}
              </span>
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

      <main className="relative z-10 flex min-h-0 flex-1 flex-col px-6 pt-6 pb-6 sm:px-12 sm:pt-9 sm:pb-10">
        <div className="flex flex-col items-start gap-1.5">
          <span
            aria-hidden
            className="mb-1.5 h-0.5 w-6"
            style={{ backgroundColor: LAUNCHER_BRAND.accent }}
          />
          <h1
            className="m-0 text-[18px] font-normal tracking-[0.01em]"
            style={{ color: LAUNCHER_BRAND.text }}
          >
            {t(`greeting.${greeting}`)}, <span className="font-semibold">{displayName}</span>
          </h1>
          <p className="m-0 text-[12.5px]" style={{ color: LAUNCHER_BRAND.subText }}>
            {t("subtitle")}
          </p>
        </div>

        <div className="mx-auto mt-11 flex w-full max-w-[720px] flex-col">
          <nav
            aria-label={t("title")}
            className="grid w-full grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-x-3 gap-y-[30px]"
          >
            {visible.map((item) => {
              const tileId = item.id as LauncherTileId;
              const badge = badges[item.id];
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className="group/hub flex flex-col items-center gap-2.5 text-center"
                >
                  <span
                    className="relative grid size-[60px] place-items-center overflow-visible rounded-[18px]"
                    style={{
                      backgroundColor: launcherTileHex(item.id),
                      boxShadow: TILE_SHADOW,
                    }}
                  >
                    <span className="inline-grid origin-center transition-transform duration-200 ease-[var(--ease-out)] motion-reduce:transition-none motion-reduce:group-hover/hub:scale-100 [@media(hover:hover)_and_(pointer:fine)]:group-hover/hub:scale-[1.4]">
                      <LauncherGlyph id={tileId} />
                    </span>
                    {badge ? (
                      <span
                        className="absolute -end-[7px] -top-[7px] z-10 inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[11px] px-[5px] text-[11px] font-bold tabular-nums text-white"
                        style={{
                          backgroundColor: LAUNCHER_BRAND.badge,
                          border: `2px solid ${LAUNCHER_BRAND.badgeBorder}`,
                        }}
                      >
                        {badge > 999 ? "999+" : badge}
                      </span>
                    ) : null}
                  </span>
                  <span
                    className="text-[12px] font-medium leading-[1.3]"
                    style={{ color: LAUNCHER_BRAND.tileLabel }}
                  >
                    {labels.get(item.id) ?? item.defaultLabel}
                  </span>
                </Link>
              );
            })}
          </nav>

          <div className="relative mx-auto mt-[60px] pt-[9px] ps-[15px]">
            <img
              src="/launcher-passion.png"
              alt=""
              aria-hidden
              className="absolute start-0 top-0 w-[17px]"
            />
            <div
              className="text-[12px] font-bold tracking-[0.22em] whitespace-nowrap"
              style={{ color: LAUNCHER_BRAND.text }}
            >
              {t("slogan")}
            </div>
          </div>
        </div>
      </main>

      <footer
        className="relative z-10 shrink-0 px-4 pt-[18px] pb-[22px] text-center text-[12px]"
        style={{ color: LAUNCHER_BRAND.footer }}
      >
        <span className="font-semibold" style={{ color: LAUNCHER_BRAND.text }}>
          {t("company")}
        </span>
      </footer>
    </div>
  );
}
