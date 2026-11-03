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
import { AccessAvatar } from "./access-parts";

const KINDS: { id: StaffAccessKind; labelKey: string }[] = [
  { id: "manager", labelKey: "fullAccessManager" },
  { id: "user", labelKey: "kindUser" },
  { id: "partner", labelKey: "kindPartner" },
];

/**
 * The editable twin of `Person Header` (7104:17998): same avatar, name and meta
 * line, with the role / access-kind controls the editor needs.
 */
export function UserAccessHeader({
  id,
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
  id: string;
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
    unassigned: "Unassigned",
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
  const roleTag = department ? t(`dept.${department}`) : roleName;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <AccessAvatar id={id} name={name} size={56} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-xl font-bold leading-7 text-[#27273f]">{name}</h2>
            {roleTag ? (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#eeebef] py-[3px] ps-2 pe-2.5 text-xs font-medium text-[#6e6a7c]">
                <span className="size-1.5 rounded-full bg-[#6e6a7c]" aria-hidden />
                {roleTag}
              </span>
            ) : null}
          </div>
          <p className="truncate text-[13px] leading-[18px] text-[#5e5e72]">
            {[email, changed].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {roles.length > 0 ? (
          <Select
            items={roleItems}
            value={roleId ?? undefined}
            onValueChange={(value) => {
              if (value) onRoleId(value);
            }}
            disabled={disabled}
          >
            <SelectTrigger className="h-9 w-[184px] rounded-lg border-[#e4ddd9] bg-white text-xs">
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

        <div className="flex h-9 items-center gap-px rounded-lg bg-[#f1eeec] p-[3px]">
          {KINDS.map((seg) => {
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
                    ? "bg-[#27273f] font-medium text-white"
                    : "text-[#5e5e72] hover:text-[#27273f]",
                )}
              >
                {t(seg.labelKey)}
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
            <SelectTrigger className="h-9 w-[184px] rounded-lg border-[#e4ddd9] bg-white text-xs">
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
  );
}
