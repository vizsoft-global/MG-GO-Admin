"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
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

/**
 * Figma renders the three access levels as one equal-width segmented control where
 * the selected "None" stays neutral grey — SegmentOption only offers primary/success.
 */
function AccessSegment({
  selected,
  tone,
  onClick,
  children,
}: {
  selected: boolean;
  tone: "neutral" | "primary" | "success";
  onClick: () => void;
  children: ReactNode;
}) {
  const selectedClass =
    tone === "success"
      ? "border-emerald-500 bg-emerald-100 text-emerald-900 shadow-sm ring-1 ring-emerald-400/50"
      : tone === "primary"
        ? "border-primary bg-primary/15 text-primary ring-1 ring-primary/30"
        : "border-border bg-muted text-foreground";

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-full cursor-pointer items-center justify-center gap-1 rounded-md border px-1.5 text-xs font-semibold transition-[color,background-color,border-color,box-shadow] duration-150 ease-out",
        selected
          ? selectedClass
          : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      {selected && tone === "success" ? <Check className="h-3 w-3 stroke-[2.5]" /> : null}
      {children}
    </button>
  );
}

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
      <SheetContent
        side="right"
        className="flex h-full w-full max-h-[100dvh] flex-col sm:max-w-md"
        // Sheet's own data-[side=right]:sm:max-w-sm outranks utility classes here.
        style={{ maxWidth: "min(440px, 100vw)" }}
      >
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
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {tTypes(type)}
                  </span>
                  <div className="grid w-[186px] shrink-0 grid-cols-3 gap-1">
                    {LEVELS.map((lvl) => (
                      <AccessSegment
                        key={lvl}
                        selected={level === lvl}
                        onClick={() => setLevel(type, lvl)}
                        tone={
                          lvl === "approver" ? "success" : lvl === "view_only" ? "primary" : "neutral"
                        }
                      >
                        {t(`level.${lvl}`)}
                      </AccessSegment>
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
