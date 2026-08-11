"use client";

import {
  ClipboardList,
  FileWarning,
  Fuel,
  HandCoins,
  FileText,
  Package,
  CalendarOff,
  Settings2,
  ScrollText,
  BarChart3,
  PenLine,
  HeartPulse,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { AppPage, AppPageHeader } from "@/components/app";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { useRequestTypeCounts } from "./use-requests";

type TypeTile = {
  type: string;
  href: string;
  icon: LucideIcon;
  tint: string;
};

const TYPE_TILES: TypeTile[] = [
  { type: "leave", href: "/requests/overview?type=leave", icon: CalendarOff, tint: "bg-emerald-500" },
  { type: "asset", href: "/requests/overview?type=asset", icon: Package, tint: "bg-violet-500" },
  { type: "fuel", href: "/requests/overview?type=fuel", icon: Fuel, tint: "bg-orange-500" },
  { type: "loan", href: "/requests/overview?type=loan", icon: HandCoins, tint: "bg-blue-500" },
  { type: "complaint", href: "/requests/overview?type=complaint", icon: FileWarning, tint: "bg-rose-500" },
  { type: "document", href: "/requests/overview?type=document", icon: FileText, tint: "bg-indigo-500" },
  { type: "salary_justification", href: "/requests/overview?type=salary_justification", icon: Wallet, tint: "bg-amber-500" },
  { type: "sick_leave", href: "/requests/overview?type=sick_leave", icon: HeartPulse, tint: "bg-red-500" },
];

type OpTile = {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  tint: string;
  countKey?: "all" | "esign";
};

const OP_TILES: OpTile[] = [
  { href: "/requests/esign", labelKey: "hub.esign", icon: PenLine, tint: "bg-purple-500" },
  { href: "/requests/overview", labelKey: "hub.all", icon: ClipboardList, tint: "bg-teal-500", countKey: "all" },
  { href: "/requests/reports", labelKey: "hub.reports", icon: BarChart3, tint: "bg-cyan-600" },
  { href: "/requests/settings/audit", labelKey: "hub.audit", icon: ScrollText, tint: "bg-slate-500" },
  { href: "/requests/settings", labelKey: "hub.settings", icon: Settings2, tint: "bg-green-600" },
];

function TileIcon({
  Icon,
  tint,
  count,
}: {
  Icon: LucideIcon;
  tint: string;
  count?: number;
}) {
  return (
    <span className="relative inline-flex">
      <span
        className={cn(
          "inline-flex h-14 w-14 items-center justify-center rounded-2xl shadow-sm",
          tint,
        )}
      >
        <Icon className="h-6 w-6 text-white" />
      </span>
      {count != null && count > 0 ? (
        <span className="absolute -end-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white ring-2 ring-card">
          {count > 999 ? "999+" : count}
        </span>
      ) : null}
    </span>
  );
}

export function RequestsHubShell() {
  const t = useTranslations("pages.requests");
  const { data } = useRequestTypeCounts();
  const counts = data?.counts ?? {};
  const totalPending = Object.values(counts).reduce((sum, c) => sum + c.pending, 0);

  return (
    <AppPage>
      <AppPageHeader title={t("title")} description={t("hub.subtitle")} />

      <div className="flex flex-col items-center gap-1 pt-2 text-center">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("hub.requestTypesHeading")}
        </h2>
      </div>
      <div className="mx-auto grid grid-cols-2 gap-4 pt-3 sm:grid-cols-4 sm:gap-6">
        {TYPE_TILES.map((tile) => (
          <Link
            key={tile.type}
            href={tile.href}
            className="flex flex-col items-center gap-2 rounded-xl p-2 text-center transition-colors hover:bg-muted/40"
          >
            <TileIcon Icon={tile.icon} tint={tile.tint} count={counts[tile.type]?.pending} />
            <span className="text-xs font-medium text-foreground">
              {t(`hub.${tile.type}` as "hub.leave")}
            </span>
          </Link>
        ))}
      </div>

      <div className="mt-6 flex flex-col items-center gap-1 text-center">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("hub.operationsHeading")}
        </h2>
      </div>
      <div className="mx-auto grid grid-cols-2 gap-4 pt-3 sm:grid-cols-5 sm:gap-6">
        {OP_TILES.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className="flex flex-col items-center gap-2 rounded-xl p-2 text-center transition-colors hover:bg-muted/40"
          >
            <TileIcon
              Icon={tile.icon}
              tint={tile.tint}
              count={tile.countKey === "all" ? totalPending : undefined}
            />
            <span className="text-xs font-medium text-foreground">{t(tile.labelKey)}</span>
          </Link>
        ))}
      </div>
    </AppPage>
  );
}
