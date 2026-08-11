"use client";

import { useTranslations } from "next-intl";
import {
  Building2,
  CalendarDays,
  ClipboardList,
  DoorOpen,
  Layers,
  List,
  PieChart,
} from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { TabBar, type TabItem } from "@/components/dashboard/tab-bar";
import { useAuth } from "@/contexts/auth-context";

type VisitTabRoute = {
  id: string;
  href: string;
  icon: typeof List;
  perm?: "visits.operate" | "visits.manage_catalog";
};

const TAB_ROUTES: VisitTabRoute[] = [
  { id: "list", href: "/visit-bookings/all", icon: List },
  { id: "calendar", href: "/visit-bookings/calendar", icon: CalendarDays },
  { id: "reception", href: "/visit-bookings/reception", icon: DoorOpen, perm: "visits.operate" },
  { id: "reports", href: "/visit-bookings/reports", icon: PieChart },
  { id: "slots", href: "/visit-bookings/slots", icon: Layers, perm: "visits.manage_catalog" },
  {
    id: "departments",
    href: "/visit-bookings/departments",
    icon: ClipboardList,
    perm: "visits.manage_catalog",
  },
  { id: "branches", href: "/visit-bookings/branches", icon: Building2, perm: "visits.manage_catalog" },
];

function activeTabFromPath(pathname: string): string {
  if (pathname.includes("/visit-bookings/calendar")) return "calendar";
  if (pathname.includes("/visit-bookings/reception")) return "reception";
  if (pathname.includes("/visit-bookings/reports")) return "reports";
  if (pathname.includes("/visit-bookings/slots")) return "slots";
  if (pathname.includes("/visit-bookings/departments")) return "departments";
  if (pathname.includes("/visit-bookings/branches")) return "branches";
  if (pathname.includes("/visit-bookings/all")) return "list";
  if (pathname.match(/\/visit-bookings\/[^/]+$/)) return "list";
  return "list";
}

export function VisitsTabBar() {
  const t = useTranslations("pages.visitBookings");
  const pathname = usePathname();
  const router = useRouter();
  const { can } = useAuth();
  const activeId = activeTabFromPath(pathname);

  const visibleTabs = TAB_ROUTES.filter(
    (tab) => !tab.perm || can(tab.perm),
  );

  const items: TabItem[] = visibleTabs.map((tab) => ({
    id: tab.id,
    label: t(`nav.${tab.id}`),
    icon: tab.icon,
  }));

  return (
    <TabBar
      items={items}
      activeId={activeId}
      onSelect={(id) => {
        const tab = visibleTabs.find((r) => r.id === id);
        if (tab) router.push(tab.href);
      }}
      className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 pb-0 backdrop-blur supports-[backdrop-filter]:bg-background/80"
    />
  );
}
