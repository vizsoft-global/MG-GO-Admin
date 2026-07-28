"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { createDriverGroup, updateDriverGroup } from "./driver-groups-actions";
import {
  DriverGroupFormFields,
  type DriverGroupFormValues,
} from "./driver-group-form-fields";
import type { DriverGroupDetail } from "./types";

export function DriverGroupFormDialog({
  open,
  onOpenChange,
  group,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group?: DriverGroupDetail | null;
  onSaved: (id: string) => void;
}) {
  const t = useTranslations("pages.driverGroups");
  const [values, setValues] = useState<DriverGroupFormValues>({
    name: "",
    description: "",
    iconKey: "users",
    memberIds: [],
  });
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setValues({
      name: group?.name ?? "",
      description: group?.description ?? "",
      iconKey: group?.icon_key ?? "users",
      memberIds: group?.member_ids ?? [],
    });
  }, [open, group]);

  const handleSave = () => {
    startTransition(async () => {
      const payload = {
        name: values.name,
        description: values.description,
        iconKey: values.iconKey,
        memberIds: values.memberIds,
      };
      const result = group
        ? await updateDriverGroup(group.id, payload)
        : await createDriverGroup(payload);
      if ("error" in result) {
        toast.error(t("saveFailed"));
        return;
      }
      toast.success(t(group ? "updated" : "created"));
      onSaved("id" in result ? result.id : group!.id);
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(640px,96vw)] overflow-visible" showCloseButton closeOutside>
        <div className="space-y-3 pt-4">
          <DriverGroupFormFields values={values} onChange={setValues} />
        </div>
        <AppModalFooter
          title={group ? t("editTitle") : t("createTitle")}
          subtitle={t("formSubtitle")}
        >
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm"
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm text-primary-foreground"
            disabled={pending || !values.name.trim()}
            onClick={handleSave}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("save")}
          </button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
