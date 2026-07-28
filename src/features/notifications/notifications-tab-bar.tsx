"use client";

import { useTranslations } from "next-intl";
import {
  BarChart3,
  Bell,
  Sparkles,
  Workflow,
} from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { TabBar, type TabItem } from "@/components/dashboard/tab-bar";

const TAB_ROUTES = [
  { id: "overview", href: "/notifications" },
  { id: "templates", href: "/notifications/templates" },
  { id: "automations", href: "/notifications/automations" },
  { id: "analytics", href: "/notifications/analytics" },
] as const;

function activeTabFromPath(pathname: string): (typeof TAB_ROUTES)[number]["id"] {
  if (
    pathname === "/notifications" ||
    pathname.endsWith("/notifications")
  ) {
    return "overview";
  }
  if (pathname.includes("/notifications/templates")) return "templates";
  if (pathname.includes("/notifications/automations")) return "automations";
  if (pathname.includes("/notifications/analytics")) return "analytics";
  return "overview";
}

export function NotificationsTabBar() {
  const t = useTranslations("pages.notifications");
  const pathname = usePathname();
  const router = useRouter();
  const activeId = activeTabFromPath(pathname);

  const items: TabItem[] = [
    { id: "overview", label: t("title"), icon: Bell },
    { id: "templates", label: t("navTemplates"), icon: Sparkles },
    { id: "automations", label: t("navAutomations"), icon: Workflow },
    { id: "analytics", label: t("navAnalytics"), icon: BarChart3 },
  ];

  return (
    <TabBar
      items={items}
      activeId={activeId}
      onSelect={(id) => {
        const tab = TAB_ROUTES.find((r) => r.id === id);
        if (tab) router.push(tab.href);
      }}
      className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 pb-0 backdrop-blur supports-[backdrop-filter]:bg-background/80"
    />
  );
}
