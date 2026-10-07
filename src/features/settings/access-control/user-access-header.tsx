"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { selectOptionsFrom } from "@/lib/select-items";
import { useTranslations } from "next-intl";
import { STAFF_DEPARTMENTS, type StaffDepartment } from "@/lib/auth/app-access";
import type { StaffAccessKind } from "@/lib/auth/staff-access";
import type { StaffLastChanged } from "@/features/settings/staff-access-actions";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

export function UserAccessHeader({
  name,
  email,
  roleName,
  lastChanged,
  locale,
  department,
  onDepartment,
  accessKind,
  onAccessKind,
  disabled,
}: {
  name: string;
  email: string | null;
  roleName: string | null;
  lastChanged: StaffLastChanged;
  locale: string;
  department: StaffDepartment | null;
  onDepartment: (value: StaffDepartment | null) => void;
  accessKind: StaffAccessKind;
  onAccessKind: (kind: StaffAccessKind) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("pages.settings.accessControl");
  const deptItems = selectOptionsFrom(
    ["none", ...STAFF_DEPARTMENTS],
    (value) => value,
    (value) => (value === "none" ? t("departmentUnset") : t(`dept.${value}`)),
  );
  const changed =
    lastChanged.at != null
      ? t("lastChanged", {
          name: lastChanged.by ?? t("someone"),
          date: new Date(lastChanged.at).toLocaleDateString(locale, {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
        })
      : t("lastChangedNever");
  const roleTag = [department ? t(`dept.${department}`) : null, roleName]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#ECECEE] bg-white px-4 pt-4 pb-3.5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-[46px] shrink-0 items-center justify-center rounded-full bg-[#FDE68A] text-[15px] font-semibold text-[#4F3F01]">
          {initials(name)}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-base font-bold text-[#111827]">{name}</p>
            {roleTag ? (
              <span className="shrink-0 rounded-md bg-[#F4F4F5] px-[7px] py-[3px] text-[10px] font-medium text-[#52525B]">
                {roleTag}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-[10.5px] text-[#71717A]">
            {[email, changed].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Select
          items={deptItems}
          value={department ?? "none"}
          onValueChange={(value) =>
            onDepartment(value && value !== "none" ? (value as StaffDepartment) : null)
          }
          disabled={disabled}
        >
          <SelectTrigger className="h-9 w-[184px] rounded-lg border-[#E4E4E7] bg-white text-[12.5px]">
            <SelectValue placeholder={t("department")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("departmentUnset")}</SelectItem>
            {STAFF_DEPARTMENTS.map((dept) => (
              <SelectItem key={dept} value={dept}>
                {t(`dept.${dept}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex h-9 items-center gap-px rounded-lg bg-[#F1F3F5] p-[3px]">
          {(
            [
              { id: "manager" as const, label: t("fullAccessManager") },
              { id: "user" as const, label: t("kindUser") },
            ]
          ).map((seg) => {
            const active = accessKind === seg.id;
            return (
              <button
                key={seg.id}
                type="button"
                aria-pressed={active}
                disabled={disabled}
                onClick={() => onAccessKind(seg.id)}
                className={cn(
                  "inline-flex h-[30px] cursor-pointer items-center rounded-md px-2.5 text-[11px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
                  active
                    ? "bg-[#18181B] font-medium text-white"
                    : "text-[#6B7280] hover:text-[#18181B]",
                )}
              >
                {seg.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
