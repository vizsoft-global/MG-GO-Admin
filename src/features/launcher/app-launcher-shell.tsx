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
import { LAUNCHER_BRAND_TINT } from "@/lib/menu/module-colors";
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
    <div className="flex min-h-svh flex-col bg-[#0B1220] px-8 py-5 text-white">
      <header className="grid grid-cols-[1fr_minmax(280px,420px)_1fr] items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2.5 justify-self-start">
          <Logo size="sm" framed priority />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-[15px] font-semibold tracking-tight">
              {branding.appName}
            </span>
            <span className="truncate text-[11px] text-white/55">{branding.appSubtitle}</span>
          </span>
        </Link>

        <label className="relative w-full justify-self-center">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-white/40" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-9 rounded-lg border-white/10 bg-white/8 ps-9 text-white placeholder:text-white/40"
          />
          <kbd className="pointer-events-none absolute end-2 top-1/2 hidden -translate-y-1/2 rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/50 sm:inline">
            {t("searchHint")}
          </kbd>
        </label>

        <div className="flex items-center justify-self-end gap-2">
          <Link
            href="/notifications"
            className="grid size-9 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
            aria-label={tNav("nav.notifications")}
          >
            <Bell className="size-4" />
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex h-9 cursor-pointer items-center gap-2 rounded-full pe-2 hover:bg-white/10">
              <Avatar className="h-8 w-8">
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

      <section className="mt-10 text-center">
        <h1 className="text-[34px] font-semibold leading-none tracking-tight">
          {t(`greeting.${greeting}`)}, {displayName}
        </h1>
        <p className="mt-2 text-sm text-white/55">{t("subtitle")}</p>
      </section>

      <div className="mx-auto mt-10 grid w-full max-w-[1080px] grid-cols-3 gap-x-6 gap-y-7 sm:grid-cols-4 xl:grid-cols-6">
        {visible.map((item) => {
          const Icon = resolveIcon(item.defaultIcon);
          const badge = badges[item.id];
          return (
            <Link
              key={item.id}
              href={item.href}
              className="group flex flex-col items-center gap-2 text-center"
            >
              <span className="relative grid size-[72px] place-items-center rounded-2xl" style={{ backgroundColor: LAUNCHER_BRAND_TINT.tile }}>
                <Icon className="size-7 text-white" aria-hidden />
                {badge ? (
                  <span className="absolute -end-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold tabular-nums text-white">
                    {badge > 999 ? "999+" : badge}
                  </span>
                ) : null}
              </span>
              <p className="max-w-[120px] text-[12px] font-medium leading-snug text-white/90">
                {labels.get(item.id) ?? item.defaultLabel}
              </p>
            </Link>
          );
        })}
      </div>

      <footer className="mt-auto pt-10 text-center text-[11px] text-white/40">
        {t("footer", {
          name: branding.appName,
          subtitle: branding.appSubtitle,
          version: APP_PANEL_VERSION,
        })}
      </footer>
    </div>
  );
}
