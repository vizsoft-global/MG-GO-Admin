"use client";

import { UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { SearchField } from "@/components/app";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
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

const AVATAR_TINTS = [
  "bg-teal-100 text-teal-800",
  "bg-sky-100 text-sky-800",
  "bg-violet-100 text-violet-800",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-800",
  "bg-emerald-100 text-emerald-800",
];

function avatarTint(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length];
}

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

  return (
    <aside className="flex min-h-0 flex-col rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-2 p-3">
        <p className="text-sm font-semibold">{t("usersTitle")}</p>
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-2 text-[11px]"
          render={<Link href="/settings/access-requests" />}
        >
          <UserPlus className="me-1 size-3.5" />
          {t("inviteUser")}
        </Button>
      </div>
      <div className="space-y-2 px-3 pb-2">
        <SearchField
          value={search}
          onChange={onSearch}
          placeholder={t("searchUsers")}
          clearLabel={t("clearSearch")}
        />
        <div className="flex flex-wrap gap-1">
          {DEPT_KEYS.map((chip) => (
            <ToggleChip
              key={chip.id}
              selected={department === chip.id}
              onClick={() => onDepartment(chip.id)}
            >
              {t(chip.labelKey)}
            </ToggleChip>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {visible.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">{t("emptyUsers")}</p>
        ) : (
          <ul className="space-y-1">
            {visible.map((row) => {
              const name = row.fullName ?? row.email ?? "—";
              const selected = row.id === selectedId;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(row.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start transition-colors duration-150",
                      selected
                        ? "bg-primary/10 ring-1 ring-primary/30"
                        : "hover:bg-muted/60",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                        avatarTint(name),
                      )}
                    >
                      {initials(row.fullName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold">{name}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {row.roleName ?? t("noRole")}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
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
    </aside>
  );
}
