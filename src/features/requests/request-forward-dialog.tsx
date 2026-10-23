"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Forward, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SearchSelect, type SearchSelectItem } from "@/components/ui/search-select";
import { Textarea } from "@/components/ui/textarea";
import { avatarTintFromName } from "@/features/drivers/form/driver-form-primitives";
import { cn } from "@/lib/utils";
import { fetchStaffForForward, type ForwardStaffOption } from "./requests-actions";
import { useForwardRequest } from "./use-requests";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

export function RequestForwardDialog({
  open,
  onOpenChange,
  requestId,
  requestCode,
  requestTypeLabel,
  fromName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: string;
  requestCode?: string;
  requestTypeLabel?: string;
  fromName?: string;
}) {
  const t = useTranslations("pages.rcmV2.forward");
  const forward = useForwardRequest();
  const [staff, setStaff] = useState<ForwardStaffOption[]>([]);
  const [toUserId, setToUserId] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    void fetchStaffForForward().then(setStaff);
  }, [open]);

  function departmentLabel(value: string | null): string | null {
    if (
      value !== "hr" &&
      value !== "accounts" &&
      value !== "admin" &&
      value !== "operations_fleet"
    ) {
      return null;
    }
    switch (value) {
      case "hr":
        return t("departments.hr");
      case "accounts":
        return t("departments.accounts");
      case "admin":
        return t("departments.admin");
      case "operations_fleet":
        return t("departments.operations_fleet");
      default: {
        const unreachable: never = value;
        return unreachable;
      }
    }
  }

  function accessLabel(row: ForwardStaffOption): string {
    const kind = row.accessKind;
    switch (kind) {
      case "manager":
        return t("accessManager");
      case "user":
        return row.roleName || t("accessUser");
      case null:
        return row.roleName || t("accessUser");
      default: {
        const unreachable: never = kind;
        return unreachable;
      }
    }
  }

  function colleagueLabel(row: ForwardStaffOption): string {
    const role = [departmentLabel(row.department), accessLabel(row)].filter(Boolean).join(" · ");
    return role ? `${row.full_name} — ${role}` : row.full_name;
  }

  const items: SearchSelectItem[] = staff.map((row) => ({
    value: row.id,
    label: colleagueLabel(row),
    hint: [departmentLabel(row.department), accessLabel(row)].filter(Boolean).join(" · "),
    keywords: [row.full_name, row.email ?? "", row.roleName ?? ""],
  }));

  const selected = staff.find((row) => row.id === toUserId);

  const subtitle = useMemo(() => {
    if (!requestCode && !requestTypeLabel && !fromName) return t("subtitle");
    const typeFrom =
      requestTypeLabel && fromName
        ? t("typeFrom", { type: requestTypeLabel, name: fromName })
        : [requestTypeLabel, fromName ? t("fromName", { name: fromName }) : ""].filter(Boolean).join(" ");
    return [requestCode, typeFrom].filter(Boolean).join(" · ");
  }, [fromName, requestCode, requestTypeLabel, t]);

  async function submit() {
    if (!toUserId || !note.trim()) {
      toast.error(t("required"));
      return;
    }
    const result = await forward.mutateAsync({ requestId, toUserId, note: note.trim() });
    if (!result.ok) {
      toast.error(result.error ?? t("failed"));
      return;
    }
    toast.success(t("saved"));
    setNote("");
    setToUserId("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !forward.isPending && onOpenChange(next)}>
      <DialogContent
        className="flex w-[min(640px,96vw)] flex-col gap-0 rounded-xl p-0"
        showCloseButton={!forward.isPending}
      >
        <DialogHeader className="border-b border-border px-5 py-3 pe-14">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-5 py-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("staff")}
            </Label>
            <div
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-lg",
                selected && "ring-1 ring-orange-400",
              )}
            >
              {selected ? (
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    avatarTintFromName(selected.full_name),
                  )}
                >
                  {initials(selected.full_name)}
                </span>
              ) : null}
              <div className="min-w-0 flex-1">
                <SearchSelect
                  value={toUserId}
                  onChange={(next) => setToUserId(next ?? "")}
                  items={items}
                  placeholder={t("staffPlaceholder")}
                  searchPlaceholder={t("staffPlaceholder")}
                  recentsKey="request-forward-staff"
                />
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="forward-note" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("note")}
              <span className="ms-0.5 text-destructive">*</span>
            </Label>
            <Textarea
              id="forward-note"
              className="min-h-16 text-sm"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {selected
                ? t("info", { name: selected.full_name })
                : t("infoPending")}
            </span>
          </p>
        </div>
        <DialogFooter className="border-t border-border px-5 py-3 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="h-9"
            disabled={forward.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            className="h-9 bg-zinc-950 text-white hover:bg-zinc-800"
            disabled={forward.isPending}
            onClick={() => void submit()}
          >
            {forward.isPending ? (
              <Loader2 className="me-1.5 size-3.5 animate-spin" />
            ) : (
              <Forward className="me-1.5 size-3.5" />
            )}
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
