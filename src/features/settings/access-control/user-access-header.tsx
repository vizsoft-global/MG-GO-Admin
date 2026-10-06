"use client";

import { useTranslations } from "next-intl";
import { Copy, RotateCcw } from "lucide-react";
import { SegmentOption } from "@/components/app/toggle-chip";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { selectOptionsFrom } from "@/lib/select-items";
import { STAFF_DEPARTMENTS, type StaffDepartment } from "@/lib/auth/app-access";
import type { StaffAccessKind } from "@/lib/auth/staff-access";
import type { StaffLastChanged } from "@/features/settings/staff-access-actions";

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
  onCopy,
  onReset,
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
  onCopy: () => void;
  onReset: () => void;
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

  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {[email, roleName].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">{changed}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" variant="outline" className="h-9" onClick={onCopy} disabled={disabled}>
            <Copy className="me-1.5 size-3.5" />
            {t("copyAccess")}
          </Button>
          <Button type="button" variant="outline" className="h-9" onClick={onReset} disabled={disabled}>
            <RotateCcw className="me-1.5 size-3.5" />
            {t("resetRole")}
          </Button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Select
          items={deptItems}
          value={department ?? "none"}
          onValueChange={(value) =>
            onDepartment(value && value !== "none" ? (value as StaffDepartment) : null)
          }
          disabled={disabled}
        >
          <SelectTrigger className="h-9 w-[200px]">
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
        <div className="flex items-center gap-1">
          <SegmentOption
            selected={accessKind === "manager"}
            onClick={() => onAccessKind("manager")}
            disabled={disabled}
            variant="success"
          >
            {t("fullAccessManager")}
          </SegmentOption>
          <SegmentOption
            selected={accessKind === "user"}
            onClick={() => onAccessKind("user")}
            disabled={disabled}
          >
            {t("kindUser")}
          </SegmentOption>
        </div>
      </div>
    </div>
  );
}
