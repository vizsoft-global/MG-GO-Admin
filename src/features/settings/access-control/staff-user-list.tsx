"use client";

import { ChevronRight, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { type StaffDepartment } from "@/lib/auth/app-access";
import type { StaffAccessListRow } from "@/features/settings/staff-access-actions";
import { cn } from "@/lib/utils";
import { AccessAvatar, AccessTag } from "./access-parts";
import { ACCESS_CARD, ACCESS_SELECTED_BG, accessRowSummary } from "./access-ui";

const DEPT_KEYS: { id: "all" | StaffDepartment; labelKey: string }[] = [
  { id: "all", labelKey: "deptAll" },
  { id: "hr", labelKey: "deptHr" },
  { id: "accounts", labelKey: "deptAccounts" },
  { id: "admin", labelKey: "deptAdmin" },
  { id: "operations_fleet", labelKey: "deptOperations" },
];

/**
 * `Staff List` (7103:29580). One card: header (`Staff` + `N people`), search,
 * the department chips and the rows. The selected row is the peach wash the
 * frame uses, not a side rule.
 */
export function StaffUserList({
  rows,
  selectedId,
  search,
  onSearch,
  department,
  onDepartment,
  onSelect,
  totalApps,
}: {
  rows: StaffAccessListRow[];
  selectedId: string | null;
  search: string;
  onSearch: (value: string) => void;
  department: "all" | StaffDepartment;
  onDepartment: (value: "all" | StaffDepartment) => void;
  onSelect: (id: string) => void;
  totalApps: number;
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
    <aside className={cn(ACCESS_CARD, "flex min-h-0 flex-col overflow-hidden")}>
      <div className="flex shrink-0 flex-col gap-3 border-b border-[#e4ddd9] px-5 pb-4 pt-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold leading-[22px] text-[#27273f]">{t("staffHeading")}</h2>
          <p className="text-xs text-[#8c8798]">{t("peopleCount", { count: rows.length })}</p>
        </div>

        <label className="flex h-[38px] items-center gap-2 rounded-lg border border-[#e4ddd9] px-3">
          <Search className="size-4 shrink-0 text-[#8c8798]" aria-hidden />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={t("searchUsers")}
            aria-label={t("searchUsers")}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[#27273f] outline-none placeholder:text-[#8c8798]"
          />
          {search ? (
            <button
              type="button"
              onClick={() => onSearch("")}
              className="cursor-pointer text-xs text-[#8c8798] transition-colors duration-150 hover:text-[#27273f]"
            >
              {t("clearSearch")}
            </button>
          ) : null}
        </label>

        <div className="flex flex-wrap items-center gap-1.5">
          {DEPT_KEYS.map((chip) => {
            const active = department === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                aria-pressed={active}
                onClick={() => onDepartment(chip.id)}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-2xl px-2.5 py-[5px] text-xs font-medium transition-colors duration-150",
                  active
                    ? "border border-[#27273f] bg-[#27273f] text-white"
                    : "border border-[#e4ddd9] bg-white text-[#27273f] hover:bg-[#faf8f7]",
                )}
              >
                {t(chip.labelKey)}
                <span
                  className={cn(
                    "text-[11px] font-semibold",
                    active ? "text-[#c9c6d6]" : "text-[#8c8798]",
                  )}
                >
                  {countFor(chip.id)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {visible.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-[#8c8798]">{t("emptyUsers")}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {visible.map((row) => {
              const name = row.fullName ?? row.email ?? "—";
              const selected = row.id === selectedId;
              const tag = row.isSuperAdmin
                ? t("tagSuperAdmin")
                : row.accessKind === "manager"
                  ? t("tagFullAccess")
                  : row.accessKind === "partner"
                    ? t("kindPartner")
                    : null;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(row.id)}
                    aria-current={selected}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-4 py-3 text-start transition-colors duration-150",
                      selected ? "" : "hover:bg-[#faf8f7]",
                    )}
                    style={selected ? { backgroundColor: ACCESS_SELECTED_BG } : undefined}
                  >
                    <AccessAvatar id={row.id} name={name} size={40} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-semibold leading-5 text-[#27273f]">
                          {name}
                        </span>
                        {tag ? <AccessTag label={tag} /> : null}
                      </span>
                      <span className="truncate text-xs leading-4 text-[#5e5e72]">
                        {[row.email, row.staffDepartment ? t(`dept.${row.staffDepartment}`) : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      <span className="truncate text-xs leading-4 text-[#8c8798]">
                        {accessRowSummary(row.modulesSelected, totalApps, row.tickCount)}
                      </span>
                    </span>
                    <ChevronRight className="size-3.5 shrink-0 text-[#8c8798]" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
