"use client";

import { ChevronRight, Circle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { SearchField } from "@/components/app";
import { type StaffDepartment } from "@/lib/auth/app-access";
import type { StaffAccessListRow } from "@/features/settings/staff-access-actions";
import { cn } from "@/lib/utils";

const DEPT_KEYS: { id: "all" | StaffDepartment; labelKey: string }[] = [
  { id: "all", labelKey: "deptAll" },
  { id: "hr", labelKey: "deptHr" },
  { id: "accounts", labelKey: "deptAccounts" },
  { id: "admin", labelKey: "deptAdmin" },
  { id: "operations_fleet", labelKey: "deptOperations" },
];

function initials(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

export function StaffUserList({
  rows,
  selectedId,
  search,
  onSearch,
  department,
  onDepartment,
  onSelect,
}: {
  rows: StaffAccessListRow[];
  selectedId: string | null;
  search: string;
  onSearch: (value: string) => void;
  department: "all" | StaffDepartment;
  onDepartment: (value: "all" | StaffDepartment) => void;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("pages.settings.accessControl");

  const visible = rows.filter((row) => {
    if (department !== "all" && row.staffDepartment !== department) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [row.fullName, row.email, row.roleName]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
  });

  const countFor = (id: "all" | StaffDepartment) =>
    id === "all" ? rows.length : rows.filter((row) => row.staffDepartment === id).length;

  return (
    <aside className="flex min-h-0 flex-col bg-white lg:border-e lg:border-[#E4E4E7]">
      <div className="flex shrink-0 flex-col gap-3 px-4 pt-4 pb-3">
        <p className="text-[10.5px] text-[#71717A]">{t("breadcrumb")}</p>
        <p className="text-base font-bold text-[#111827]">{t("usersTitle")}</p>
        <SearchField
          value={search}
          onChange={onSearch}
          placeholder={t("searchUsers")}
          clearLabel={t("clearSearch")}
          inputClassName="h-[38px] rounded-lg border-[#E4E4E7] bg-[#FAFAFA] text-[12.5px] ps-8"
        />
        <div className="flex flex-wrap gap-1.5">
          {DEPT_KEYS.map((chip) => {
            const active = department === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                aria-pressed={active}
                onClick={() => onDepartment(chip.id)}
                className={cn(
                  "inline-flex h-[26px] cursor-pointer items-center gap-1 rounded-full border px-2.5 text-[10.5px] font-medium transition-colors duration-150",
                  active
                    ? "border-[#18181B] bg-[#18181B] text-white"
                    : "border-[#E4E4E7] bg-white text-[#4B5563] hover:bg-[#F4F4F5]",
                )}
              >
                {t(chip.labelKey)}
                <span className={active ? "text-white/55" : "text-[#9CA3AF]"}>
                  {countFor(chip.id)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {visible.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">{t("emptyUsers")}</p>
        ) : (
          <ul>
            {visible.map((row) => {
              const name = row.fullName ?? row.email ?? "—";
              const selected = row.id === selectedId;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(row.id)}
                    className={cn(
                      "flex min-h-[66px] w-full cursor-pointer items-center gap-2.5 border-b border-s-[3px] border-black/10 px-3 py-2.5 text-start transition-colors duration-150",
                      selected
                        ? "border-s-[#B54708] bg-[#FFFAEB]"
                        : "border-s-transparent hover:bg-[#FAFAFA]",
                    )}
                  >
                    <span className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-[#FDE68A] text-[11px] font-semibold text-[#574500]">
                      {initials(row.fullName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1">
                        <span className="truncate text-[13px] font-semibold text-[#18181B]">
                          {name}
                        </span>
                        <ChevronRight className="size-3.5 shrink-0 text-[#9CA3AF]" aria-hidden />
                      </span>
                      <span className="block truncate text-[11px] text-[#6B7280]">
                        {[row.email, row.staffDepartment ? t(`dept.${row.staffDepartment}`) : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1 text-[10.5px] font-medium text-[#B54708]">
                        <Circle className="size-[9px] shrink-0 stroke-[2.5]" aria-hidden />
                        {t("modulesSelected", { count: row.modulesSelected })}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-[#ECECEE] p-4">
        <Link
          href="/settings/access-requests"
          className="flex h-9 w-full items-center justify-center rounded-lg border border-dashed border-[#9CA3AF] text-xs font-medium text-[#18181B] transition-colors duration-150 hover:bg-[#FAFAFA]"
        >
          + {t("inviteUser")}
        </Link>
      </div>
    </aside>
  );
}
