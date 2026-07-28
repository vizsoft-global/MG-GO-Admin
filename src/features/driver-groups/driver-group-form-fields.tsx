"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DriverGroupMemberPicker } from "./driver-group-member-picker";
import { DRIVER_GROUP_ICONS } from "./types";

export type DriverGroupFormValues = {
  name: string;
  description: string;
  iconKey: string;
  memberIds: string[];
};

export function DriverGroupFormFields({
  values,
  onChange,
}: {
  values: DriverGroupFormValues;
  onChange: (next: DriverGroupFormValues) => void;
}) {
  const t = useTranslations("pages.driverGroups");

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>{t("fieldName")}</Label>
        <Input
          className="h-9"
          value={values.name}
          onChange={(e) => onChange({ ...values, name: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label>{t("fieldDescription")}</Label>
        <Textarea
          rows={2}
          value={values.description}
          onChange={(e) => onChange({ ...values, description: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label>{t("fieldIcon")}</Label>
        <Select
          value={values.iconKey}
          onValueChange={(v) => onChange({ ...values, iconKey: v ?? "users" })}
        >
          <SelectTrigger className="h-9 cursor-pointer">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DRIVER_GROUP_ICONS.map((icon) => (
              <SelectItem key={icon} value={icon} className="cursor-pointer">
                {t(`icons.${icon}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>{t("fieldMembers")}</Label>
        <DriverGroupMemberPicker
          selectedIds={values.memberIds}
          onChange={(memberIds) => onChange({ ...values, memberIds })}
        />
      </div>
    </div>
  );
}
