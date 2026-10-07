"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Bell, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Logo } from "@/components/brand/logo";
import { useAuth } from "@/contexts/auth-context";
import { useBranding } from "@/contexts/branding-context";
import { useNavBadges } from "@/hooks/use-nav-badges";
import { Link } from "@/i18n/navigation";
import { signOut } from "@/features/auth/actions";
import {
  filterLauncherTiles,
  greetingBucket,
  kuwaitHour,
  LAUNCHER_LABEL_OVERRIDE,
  type LauncherTileId,
  visibleLauncherTiles,
} from "@/lib/menu/launcher-modules";
import { APP_NAV_KEY_BY_ID, resolveIcon } from "@/lib/menu/menu-registry";
import { LAUNCHER_BRAND, launcherTileHex } from "@/lib/menu/module-colors";
import type { Permission } from "@/lib/auth/permissions";
import { APP_PANEL_VERSION } from "@/lib/app/build-id";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function formatAdminRole(slug: string): string {
  if (!slug) return "";
  return slug
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
      className="flex min-h-svh flex-col text-white"
      style={{ backgroundColor: LAUNCHER_BRAND.canvas }}
    >
      <header
        className="flex h-16 shrink-0 items-center gap-4 px-6"
        style={{
          backgroundColor: LAUNCHER_BRAND.topBar,
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <Link href="/dashboard" className="flex shrink-0 items-center gap-[10px]">
          <span
            className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-md"
            style={{ backgroundColor: LAUNCHER_BRAND.logoChip }}
          >
            <Logo size="sm" priority />
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-[13px] font-semibold tracking-tight">
              {branding.appName}
            </span>
            <span className="truncate text-[11px]" style={{ color: LAUNCHER_BRAND.muted }}>
              {branding.appSubtitle}
            </span>
          </span>
        </Link>

        <span className="h-px flex-1" />

        <label
          className="relative flex h-[38px] w-[440px] max-w-[46vw] shrink-0 items-center gap-2 rounded-lg px-3"
          style={{
            backgroundColor: LAUNCHER_BRAND.search,
            border: `1px solid ${LAUNCHER_BRAND.searchBorder}`,
          }}
        >
          <Search className="size-4 shrink-0" style={{ color: LAUNCHER_BRAND.muted }} />
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-auto w-full flex-1 border-0 bg-transparent p-0 text-[13px] text-white shadow-none focus-visible:border-0 focus-visible:ring-0"
          />
          <kbd
            className="hidden shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium sm:inline"
            style={{ backgroundColor: LAUNCHER_BRAND.searchHint, color: LAUNCHER_BRAND.muted }}
          >
            {t("searchHint")}
          </kbd>
        </label>

        <span className="h-px flex-1" />

        <div className="flex shrink-0 items-center gap-3">
          <Link
            href="/notifications"
            className="relative grid size-8 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
            aria-label={tNav("nav.notifications")}
          >
            <Bell className="size-[18px]" />
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex h-9 cursor-pointer items-center gap-2 rounded-full pe-2 hover:bg-white/10">
              <Avatar className="size-8">
                <AvatarFallback className="bg-white/15 text-[10px] font-semibold text-white">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="hidden max-w-[140px] truncate text-start text-[12px] font-medium leading-tight lg:block">
                {initials} {roleLabel || displayName}
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

      <section className="mt-[72px] flex flex-col items-center gap-1.5 text-center">
        <h1 className="text-[24px] font-semibold leading-none tracking-tight">
          {t(`greeting.${greeting}`)}, {displayName}
        </h1>
        <p className="text-[14px]" style={{ color: LAUNCHER_BRAND.subText }}>
          {t("subtitle")}
        </p>
      </section>

      <div className="mx-auto mt-[52px] grid w-full max-w-[690px] grid-cols-3 justify-items-center gap-x-[30px] gap-y-[24px] sm:grid-cols-4 lg:grid-cols-6">
        {visible.map((item) => {
          const Icon = resolveIcon(item.defaultIcon);
          const badge = badges[item.id];
          return (
            <Link
              key={item.id}
              href={item.href}
              className="group flex w-[90px] flex-col items-center gap-[10px] text-center"
            >
              <span
                className="relative grid size-16 place-items-center rounded-[16px]"
                style={{ backgroundColor: launcherTileHex(item.id) }}
              >
                <Icon className="size-[30px] text-white" aria-hidden />
                {badge ? (
                  <span
                    className="absolute -end-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums text-white"
                    style={{ backgroundColor: LAUNCHER_BRAND.badge }}
                  >
                    {badge > 999 ? "999+" : badge}
                  </span>
                ) : null}
              </span>
              <p
                className="text-[13px] font-medium leading-snug"
                style={{ color: LAUNCHER_BRAND.text }}
              >
                {labels.get(item.id) ?? item.defaultLabel}
              </p>
            </Link>
          );
        })}
      </div>

      <footer
        className="mt-auto pt-12 pb-6 text-center text-[12px]"
        style={{ color: LAUNCHER_BRAND.muted }}
      >
        {t("footer", {
          name: branding.appName,
          subtitle: branding.appSubtitle,
          version: APP_PANEL_VERSION,
        })}
      </footer>
    </div>
  );
}
