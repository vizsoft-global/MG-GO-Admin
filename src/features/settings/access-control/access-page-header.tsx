"use client";

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACCESS_BTN_PRIMARY, ACCESS_KPI_DOT } from "./access-ui";

export type AccessTab = "staff" | "roles";

/** `Page Header` (7103:29527): app tile, breadcrumb, title, subtitle, one CTA. */
export function AccessPageHeader({ inviteHref }: { inviteHref: string }) {
  const t = useTranslations("pages.settings.accessControl");
  return (
    <header className="flex items-center gap-4">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#3d7070]" aria-hidden>
        <Lock className="size-[22px] text-white" strokeWidth={2} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <nav className="flex items-center gap-1.5 text-xs text-[#8c8798]" aria-label="Breadcrumb">
          <span>{t("breadcrumbApps")}</span>
          <span aria-hidden>›</span>
          <span className="font-medium text-[#5e5e72]">{t("pageTitle")}</span>
        </nav>
        <h1 className="text-2xl font-bold leading-8 text-[#27273f]">{t("pageTitle")}</h1>
        <p className="text-sm leading-5 text-[#5e5e72]">{t("pageSubtitle")}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <Link href={inviteHref} className={ACCESS_BTN_PRIMARY}>
          + {t("accessRequests")}
        </Link>
      </div>
    </header>
  );
}

/** Underline tabs with a count chip on the two tabs that hold a list. */
export function AccessTabs({
  active,
  staffCount,
  roleCount,
  onSelect,
}: {
  active: AccessTab;
  staffCount: number;
  roleCount: number;
  onSelect: (tab: "staff" | "roles") => void;
}) {
  const t = useTranslations("pages.settings.accessControl");
  return (
    <div className="flex items-center gap-8 border-b border-[#e4ddd9]" role="tablist">
      <TabButton
        active={active === "staff"}
        label={t("tabStaff")}
        count={staffCount}
        onClick={() => onSelect("staff")}
      />
      <TabButton
        active={active === "roles"}
        label={t("tabRoles")}
        count={roleCount}
        onClick={() => onSelect("roles")}
      />
    </div>
  );
}

function TabButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "-mb-px flex h-8 cursor-pointer items-center gap-2 border-b-2 text-sm transition-colors duration-150",
        active
          ? "border-[#a73c24] font-semibold text-[#27273f]"
          : "border-transparent text-[#5e5e72] hover:text-[#27273f]",
      )}
    >
      {label}
      <span
        className={cn(
          "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded px-1 text-[11px] font-semibold",
          active ? "bg-[#f6e9e4] text-[#a73c24]" : "bg-[#eeebef] text-[#6e6a7c]",
        )}
      >
        {count}
      </span>
    </button>
  );
}

export type AccessKpi = { label: string; value: number; meta: string };

/** `KPI Row` (7103:29554): four cards, 8px accent square, 28px value, meta line. */
export function AccessKpiRow({ items }: { items: AccessKpi[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <article
          key={item.label}
          className="flex flex-col gap-1.5 rounded-xl border border-[#e4ddd9] bg-white px-5 py-[18px]"
        >
          <div className="flex items-center gap-2">
            <span className={ACCESS_KPI_DOT} aria-hidden />
            <p className="text-[13px] font-medium text-[#5e5e72]">{item.label}</p>
          </div>
          <p className="text-[28px] font-bold leading-[34px] text-[#27273f]">{item.value}</p>
          <p className="text-xs leading-4 text-[#5e5e72]">{item.meta}</p>
        </article>
      ))}
    </div>
  );
}
