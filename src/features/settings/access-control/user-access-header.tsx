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
import type { StaffDepartment } from "@/lib/auth/app-access";
import {
  parsePartnerProjectKey,
  PARTNER_PROJECT_KEYS,
  type PartnerProjectKey,
  type StaffAccessKind,
} from "@/lib/auth/staff-access";
import type { StaffLastChanged } from "@/features/settings/staff-access-actions";
import type { AdminRoleRow } from "@/lib/auth/get-role-permissions";
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
  roleId,
  roles,
  onRoleId,
  accessKind,
  onAccessKind,
  partnerProjectKey = null,
  onPartnerProject,
  disabled,
  kindDisabled,
}: {
  name: string;
  email: string | null;
  roleName: string | null;
  lastChanged: StaffLastChanged;
  locale: string;
  department: StaffDepartment | null;
  roleId: string | null;
  roles: AdminRoleRow[];
  onRoleId: (roleId: string) => void;
  accessKind: StaffAccessKind;
  onAccessKind: (kind: StaffAccessKind) => void;
  partnerProjectKey?: PartnerProjectKey | null;
  onPartnerProject?: (key: PartnerProjectKey) => void;
  disabled?: boolean;
  kindDisabled?: boolean;
}) {
  const t = useTranslations("pages.settings.accessControl");
  const projectLabel: Record<PartnerProjectKey, string> = {
    keeta: "Keeta",
    americana: "Americana",
  };
  const projectItems = selectOptionsFrom(
    PARTNER_PROJECT_KEYS,
    (value) => value,
    (value) => projectLabel[value],
  );
  const roleItems = selectOptionsFrom(
    roles,
    (role) => role.id,
    (role) => role.name,
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
        <span className="flex size-[46px] shrink-0 items-center justify-center rounded-full bg-[#FDE68A] text-sm font-semibold text-[#4F3F01]">
          {initials(name)}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-base font-bold text-[#111827]">{name}</p>
            {roleTag ? (
              <span className="shrink-0 rounded-md bg-[#F4F4F5] px-[7px] py-[3px] text-xs font-medium text-[#52525B]">
                {roleTag}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-[#71717A]">
            {[email, changed].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-start gap-2">
        {roles.length > 0 ? (
          <Select
            items={roleItems}
            value={roleId ?? undefined}
            onValueChange={(value) => {
              if (value) onRoleId(value);
            }}
            disabled={disabled}
          >
            <SelectTrigger className="h-9 w-[184px] rounded-lg border-[#E4E4E7] bg-white text-xs">
              <SelectValue placeholder={t("role")} />
            </SelectTrigger>
            <SelectContent>
              {roles.map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <div className="flex flex-col items-end gap-2">
        <div className="flex h-9 items-center gap-px rounded-lg bg-[#F1F3F5] p-[3px]">
          {(
            [
              { id: "manager" as const, label: t("fullAccessManager") },
              { id: "user" as const, label: t("kindUser") },
              { id: "partner" as const, label: t("kindPartner") },
            ]
          ).map((seg) => {
            const active = accessKind === seg.id;
            return (
              <button
                key={seg.id}
                type="button"
                aria-pressed={active}
                disabled={disabled || kindDisabled}
                onClick={() => onAccessKind(seg.id)}
                className={cn(
                  "inline-flex h-[30px] cursor-pointer items-center rounded-md px-2.5 text-xs transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
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
        {accessKind === "partner" ? (
          <Select
            items={projectItems}
            value={partnerProjectKey ?? undefined}
            onValueChange={(value) => {
              const key = parsePartnerProjectKey(value);
              if (key) onPartnerProject?.(key);
            }}
            disabled={disabled || kindDisabled}
          >
            <SelectTrigger className="h-9 w-[184px] rounded-lg border-[#E4E4E7] bg-white text-xs">
              <SelectValue placeholder="Keeta" />
            </SelectTrigger>
            <SelectContent>
              {PARTNER_PROJECT_KEYS.map((key) => (
                <SelectItem key={key} value={key}>
                  {projectLabel[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        </div>
      </div>
    </div>
  );
}
