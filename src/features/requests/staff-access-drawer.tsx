"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SearchSelect } from "@/components/ui/search-select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SegmentOption } from "@/components/app/toggle-chip";
import { saveStaffAccessGrants } from "./requests-settings-actions";
import { REQUEST_TYPE_SLUGS, type AccessLevel, type RequestTypeSlug, type StaffProfileOption } from "./settings-types";

type StaffTarget = {
  id: string;
  full_name: string;
  email: string | null;
  /** Figma shows "HR · noor@example.com" under the staff name. */
  department?: string | null;
};

const LEVELS: AccessLevel[] = ["none", "view_only", "approver"];

export function StaffAccessDrawer({
  open,
  onOpenChange,
  staff,
  staffOptions,
  initialAccess,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected staff member (Edit access). Omit for Assign staff (picker shown). */
  staff?: StaffTarget | null;
  staffOptions?: StaffProfileOption[];
  initialAccess?: Partial<Record<RequestTypeSlug, AccessLevel>>;
  onSaved: () => void;
}) {
  const t = useTranslations("pages.requests.settings.roles");
  const tTypes = useTranslations("pages.requests.types");
  const isAssignMode = !staff;

  const [pickedId, setPickedId] = useState<string | null>(null);
  const [access, setAccess] = useState<Partial<Record<RequestTypeSlug, AccessLevel>>>({});
  const [saving, setSaving] = useState(false);
  /** Figma "Change" affordance: swap the pre-selected staff member for another one. */
  const [changingStaff, setChangingStaff] = useState(false);

  useEffect(() => {
    if (open) {
      setPickedId(null);
      setChangingStaff(false);
      setAccess(initialAccess ?? {});
    }
  }, [open, initialAccess]);

  const staffItems = useMemo(
    () =>
      (staffOptions ?? []).map((s) => ({
        value: s.id,
        label: s.full_name,
        hint: s.email ?? undefined,
        keywords: [s.email ?? "", s.full_name],
      })),
    [staffOptions],
  );

  const showPicker = isAssignMode || changingStaff;
  const targetId = showPicker ? (pickedId ?? staff?.id ?? null) : (staff?.id ?? null);

  function setLevel(type: RequestTypeSlug, level: AccessLevel) {
    setAccess((prev) => ({ ...prev, [type]: level }));
  }

  async function handleSave() {
    if (!targetId) {
      toast.error(t("errors.staffRequired"));
      return;
    }
    setSaving(true);
    const result = await saveStaffAccessGrants(targetId, access);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error ?? t("errors.saveFailed"));
      return;
    }
    toast.success(t("saved"));
    onOpenChange(false);
    onSaved();
  }

  const initials = staff?.full_name
    ? staff.full_name
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex h-full w-full max-h-[100dvh] flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{isAssignMode ? t("assignStaff") : t("editAccess")}</SheetTitle>
        </SheetHeader>

        <SheetBody className="space-y-4 overflow-y-auto">
          {showPicker ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{t("staffMember")}</p>
              <SearchSelect
                items={staffItems}
                value={pickedId}
                onChange={setPickedId}
                placeholder={t("staffPlaceholder")}
                searchPlaceholder={t("staffSearch")}
                recentsKey="rcm-staff-access-assign"
                className="h-9"
              />
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
              <Avatar className="h-9 w-9">
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{staff?.full_name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {[staff?.department, staff?.email].filter(Boolean).join(" · ") || "—"}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0"
                onClick={() => setChangingStaff(true)}
              >
                {t("change")}
              </Button>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            {isAssignMode ? t("perTypeHintAssign") : t("perTypeHint")}
          </p>

          <div className="space-y-2">
            {REQUEST_TYPE_SLUGS.map((type) => {
              const level = access[type] ?? "none";
              return (
                <div
                  key={type}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5"
                >
                  <span className="text-sm font-medium">{tTypes(type)}</span>
                  <div className="flex items-center gap-1">
                    {LEVELS.map((lvl) => (
                      <SegmentOption
                        key={lvl}
                        selected={level === lvl}
                        onClick={() => setLevel(type, lvl)}
                        variant={lvl === "approver" ? "success" : "default"}
                      >
                        {t(`level.${lvl}`)}
                      </SegmentOption>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </SheetBody>

        <SheetFooter>
          <Button type="button" variant="outline" className="h-9" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" className="h-9" disabled={saving} onClick={() => void handleSave()}>
            {saving ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {t("saveChanges")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
