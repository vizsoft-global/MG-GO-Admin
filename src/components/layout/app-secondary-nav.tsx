"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { LayoutDashboard } from "lucide-react";
import { useSidebarMenu } from "@/hooks/use-sidebar-menu";
import {
  findActiveLeafId,
  findInlineGroupForPath,
} from "@/lib/menu/inline-group-nav";
import { APP_NAV_KEY_BY_ID, ICON_MAP } from "@/lib/menu/menu-registry";
import type { ResolvedMenuNode } from "@/lib/menu/menu-merge";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

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

export function AppSecondaryNav() {
  const pathname = usePathname();
  const { tree } = useSidebarMenu();
  const tItemLabel = useItemLabel();

  const group = findInlineGroupForPath(tree, pathname);
  if (!group) return null;

  const children = group.children ?? [];
  if (children.length === 0) return null;

  const activeLeafId = findActiveLeafId(tree, pathname);
  const groupLabel = group.label;

  return (
    <Sidebar
      collapsible="none"
      className="hidden h-full w-56 shrink-0 border-e border-sidebar-border bg-sidebar md:flex"
    >
      <SidebarHeader className="h-11 justify-center border-b border-sidebar-border px-3">
        <SidebarGroupLabel className="px-0 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {groupLabel}
        </SidebarGroupLabel>
      </SidebarHeader>
      <SidebarContent className="px-2 py-2">
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu>
              {children.map((child) => {
                if (!child.href) return null;
                const isActive = child.id === activeLeafId;
                const label = tItemLabel(child);
                return (
                  <SidebarMenuItem key={child.id}>
                    <SidebarMenuButton
                      isActive={isActive}
                      className="h-8 cursor-pointer rounded-md text-[13px] font-normal"
                      render={
                        <Link href={child.href} prefetch>
                          <MenuIcon
                            name={child.icon}
                            className="h-3.5 w-3.5 shrink-0"
                          />
                          <span className="truncate">{label}</span>
                        </Link>
                      }
                    />
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
