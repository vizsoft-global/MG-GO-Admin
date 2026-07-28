"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import {
  Check,
  ChevronRight,
  LayoutDashboard,
  Monitor,
  Moon,
  PanelLeftClose,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import {
  findActiveLeafId,
  firstChildHref,
  groupContainsLeaf,
} from "@/lib/menu/inline-group-nav";
import { useLocale } from "next-intl";
import { BrandMark } from "@/components/brand/brand-mark";
import { Logo } from "@/components/brand/logo";
import { useAuth } from "@/contexts/auth-context";
import { signOut } from "@/features/auth/actions";
import { useHasMounted } from "@/hooks/use-has-mounted";
import { useSidebarMenu } from "@/hooks/use-sidebar-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buttonVariants } from "@/components/ui/button";
import { APP_NAV_KEY_BY_ID, ICON_MAP } from "@/lib/menu/menu-registry";
import type { ResolvedMenuNode } from "@/lib/menu/menu-merge";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  useSidebar,
} from "@/components/ui/sidebar";

const ActiveNavContext = createContext<string | null>(null);

function sidebarGroupStorageKey(groupId: string) {
  return `sidebar-group:${groupId}`;
}

function readPanelGroupOpen(groupId: string): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(sidebarGroupStorageKey(groupId)) === "open";
}

function writePanelGroupOpen(groupId: string, open: boolean) {
  localStorage.setItem(
    sidebarGroupStorageKey(groupId),
    open ? "open" : "collapsed",
  );
}

function MenuIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name] ?? LayoutDashboard;
  return <Icon className={className} />;
}

function useItemLabel() {
  const t = useTranslations();
  return (node: ResolvedMenuNode) => {
    const navKey = APP_NAV_KEY_BY_ID[node.id];
    if (!navKey) return node.label;
    const translated = t(`nav.${navKey}`);
    if (node.label && node.label !== translated && node.label !== navKey) {
      return node.label;
    }
    return translated;
  };
}

function useGroupLabel() {
  return (label: string) => label;
}

function SidebarCollapseTrigger({ className }: { className?: string }) {
  const t = useTranslations("common");
  const { state, toggleSidebar } = useSidebar();

  if (state !== "expanded") return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn(
        "hidden shrink-0 cursor-pointer text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground md:inline-flex",
        className,
      )}
      title={t("collapseSidebar")}
      onClick={toggleSidebar}
    >
      <PanelLeftClose className="h-4 w-4" />
      <span className="sr-only">{t("collapseSidebar")}</span>
    </Button>
  );
}

function NavItemLink({
  node,
  label,
}: {
  node: ResolvedMenuNode;
  label: string;
}) {
  const activeLeafId = useContext(ActiveNavContext);
  if (!node.href) return null;
  const isActive = node.id === activeLeafId;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        tooltip={label}
        className="h-8 cursor-pointer rounded-md px-2.5 text-[13px] font-normal text-sidebar-foreground shadow-none hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground focus-visible:ring-0 data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-accent-foreground"
        render={
          <Link href={node.href} prefetch>
            <MenuIcon name={node.icon} className="h-3.5 w-3.5 shrink-0" />
            <span>{label}</span>
          </Link>
        }
      />
    </SidebarMenuItem>
  );
}

function NavGroupLabel({ label }: { label: string }) {
  const { state } = useSidebar();
  if (state === "collapsed") return null;

  return (
    <li
      data-slot="sidebar-menu-item"
      className="group/menu-item relative px-2.5 pt-2 pb-0.5"
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
    </li>
  );
}

function NavGroup({
  node,
  tItemLabel,
  tGroupLabel,
}: {
  node: ResolvedMenuNode;
  tItemLabel: (n: ResolvedMenuNode) => string;
  tGroupLabel: (label: string) => string;
}) {
  const activeLeafId = useContext(ActiveNavContext);
  const { state } = useSidebar();
  const children = node.children ?? [];
  const groupLabel = tGroupLabel(node.label);
  const collapsed = state === "collapsed";
  const isInline = node.displayMode === "inline";
  const isPanel = node.displayMode === "panel";
  const hasActiveChild = groupContainsLeaf(node, activeLeafId);

  if (isInline) {
    const href = firstChildHref(node);
    if (!href) return null;

    const isActive = hasActiveChild;

    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          isActive={isActive}
          tooltip={groupLabel}
          className="h-8 cursor-pointer rounded-md px-2.5 text-[13px] font-normal text-sidebar-foreground shadow-none hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground focus-visible:ring-0 data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-accent-foreground"
          render={
            <Link href={href} prefetch>
              <MenuIcon name={node.icon} className="h-3.5 w-3.5 shrink-0" />
              <span>{groupLabel}</span>
            </Link>
          }
        />
      </SidebarMenuItem>
    );
  }

  if (collapsed) {
    return (
      <>
        {children.map((child) => (
          <NavItemLink
            key={child.id}
            node={child}
            label={tItemLabel(child)}
          />
        ))}
      </>
    );
  }

  if (isPanel) {
    return (
      <PanelGroupChildren
        groupId={node.id}
        groupLabel={groupLabel}
        forceOpen={hasActiveChild}
        children={children}
        tItemLabel={tItemLabel}
      />
    );
  }

  return (
    <>
      <NavGroupLabel label={groupLabel} />
      <ul className="ms-3 flex list-none flex-col gap-0.5 border-s border-sidebar-border/60 ps-1.5">
        {children.map((child) => (
          <NavItemLink key={child.id} node={child} label={tItemLabel(child)} />
        ))}
      </ul>
    </>
  );
}

function PanelGroupChildren({
  groupId,
  groupLabel,
  forceOpen,
  children,
  tItemLabel,
}: {
  groupId: string;
  groupLabel: string;
  forceOpen: boolean;
  children: ResolvedMenuNode[];
  tItemLabel: (n: ResolvedMenuNode) => string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(readPanelGroupOpen(groupId));
  }, [groupId]);

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      writePanelGroupOpen(groupId, next);
      return next;
    });
  }, [groupId]);

  const showChildren = open || forceOpen;

  return (
    <>
      <li
        data-slot="sidebar-menu-item"
        className="group/menu-item relative px-2.5 pt-2 pb-0.5"
      >
        <button
          type="button"
          onClick={toggle}
          className="flex w-full cursor-pointer items-center gap-1 text-start hover:text-foreground"
          aria-expanded={showChildren}
        >
          <span className="flex-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {groupLabel}
          </span>
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200",
              showChildren && "rotate-90",
            )}
          />
        </button>
      </li>
      {showChildren ? (
        <ul className="ms-3 flex list-none flex-col gap-0.5 border-s border-sidebar-border/60 ps-1.5">
          {children.map((child) => (
            <NavItemLink key={child.id} node={child} label={tItemLabel(child)} />
          ))}
        </ul>
      ) : null}
    </>
  );
}

function NavTree({ nodes }: { nodes: ResolvedMenuNode[] }) {
  const pathname = usePathname();
  const tItemLabel = useItemLabel();
  const tGroupLabel = useGroupLabel();
  const activeLeafId = findActiveLeafId(nodes, pathname);

  const main: ResolvedMenuNode[] = [];
  const footer: ResolvedMenuNode[] = [];

  for (const n of nodes) {
    if (n.type === "item" && n.footer) footer.push(n);
    else if (n.type === "group") {
      const groupFooter = n.children?.every((c) => c.footer);
      if (groupFooter) footer.push(n);
      else main.push(n);
    } else if (n.footer) footer.push(n);
    else main.push(n);
  }

  const navNodes = [...main, ...footer];

  return (
    <ActiveNavContext.Provider value={activeLeafId}>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {navNodes.map((node) =>
              node.type === "group" ? (
                <NavGroup
                  key={node.id}
                  node={node}
                  tItemLabel={tItemLabel}
                  tGroupLabel={tGroupLabel}
                />
              ) : (
                <NavItemLink
                  key={node.id}
                  node={node}
                  label={tItemLabel(node)}
                />
              ),
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </ActiveNavContext.Provider>
  );
}

function SidebarNavSkeleton() {
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {Array.from({ length: 6 }).map((_, i) => (
            <SidebarMenuSkeleton key={i} showIcon />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function SidebarBrand() {
  const t = useTranslations("common");
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={toggleSidebar}
        title={t("expandSidebar")}
        aria-label={t("expandSidebar")}
        className="mx-auto flex size-9 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-sidebar-accent"
      >
        <Logo size="sm" framed priority />
      </button>
    );
  }

  return (
    <Link
      href="/dashboard"
      className="min-w-0 flex-1 overflow-hidden"
    >
      <BrandMark size="md" variant="sidebar" />
    </Link>
  );
}

function formatAdminRole(slug: string): string {
  if (!slug) return "";
  return slug
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const THEME_OPTIONS = [
  { value: "light", labelKey: "themeLight", icon: Sun },
  { value: "dark", labelKey: "themeDark", icon: Moon },
  { value: "system", labelKey: "themeSystem", icon: Monitor },
] as const;

function ThemeSubmenu() {
  const t = useTranslations("common");
  const { theme, setTheme, resolvedTheme } = useTheme();
  const mounted = useHasMounted();
  const current = theme ?? "system";
  const triggerIcon = mounted
    ? resolvedTheme === "dark"
      ? Moon
      : Sun
    : Monitor;
  const TriggerIcon = triggerIcon;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="cursor-pointer gap-2">
        <TriggerIcon className="size-4 text-muted-foreground" />
        {t("theme")}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-40">
        {THEME_OPTIONS.map(({ value, labelKey, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            className="cursor-pointer gap-2"
            onClick={() => setTheme(value)}
          >
            <Icon className="size-4 text-muted-foreground" />
            <span className="flex-1">{t(labelKey)}</span>
            {mounted && current === value ? (
              <Check className="size-3.5 text-muted-foreground" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function SidebarUserMenu() {
  const t = useTranslations("common");
  const locale = useLocale();
  const { state } = useSidebar();
  const { email, fullName, adminRoleSlug } = useAuth();
  const collapsed = state === "collapsed";
  const initials = (fullName ?? email ?? "A").slice(0, 2).toUpperCase();
  const roleLabel = formatAdminRole(adminRoleSlug);

  return (
    <SidebarFooter className="mt-auto px-2 py-3">
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            buttonVariants({ variant: "ghost" }),
            "h-auto w-full cursor-pointer justify-start gap-2 rounded-md px-2 py-2 hover:bg-sidebar-accent",
            collapsed && "justify-center px-0",
          )}
        >
          <Avatar className="h-7 w-7 shrink-0">
            <AvatarFallback className="bg-sidebar-accent text-[10px] font-semibold text-sidebar-accent-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="min-w-0 flex-1 text-start">
              <p className="truncate text-[13px] font-medium text-sidebar-foreground">
                {fullName ?? "Admin"}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">{email}</p>
              <p className="truncate text-[10px] text-muted-foreground/80">{roleLabel}</p>
            </div>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-medium">{fullName ?? "Admin"}</p>
                <p className="text-xs text-muted-foreground">{email}</p>
              </div>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              className="cursor-pointer"
              render={<Link href="/settings" />}
            >
              {t("settings")}
            </DropdownMenuItem>
            <ThemeSubmenu />
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => signOut(locale)}
            >
              {t("logout")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarFooter>
  );
}

export function AppSidebar() {
  const mounted = useHasMounted();
  const { tree } = useSidebarMenu();

  return (
    <Sidebar
      collapsible="icon"
      variant="sidebar"
      className="border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      <SidebarHeader className="flex flex-row items-center gap-2 px-2 py-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
        <SidebarBrand />
        <SidebarCollapseTrigger />
      </SidebarHeader>
      <SidebarContent className="flex-1 px-1.5 py-2 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
        {mounted ? <NavTree nodes={tree} /> : <SidebarNavSkeleton />}
      </SidebarContent>
      <SidebarUserMenu />
    </Sidebar>
  );
}
