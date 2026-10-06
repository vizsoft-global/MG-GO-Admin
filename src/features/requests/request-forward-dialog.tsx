"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Forward, Loader2 } from "lucide-react";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SearchSelect, type SearchSelectItem } from "@/components/ui/search-select";
import { Textarea } from "@/components/ui/textarea";
import { fetchStaffForForward } from "./requests-actions";
import { useForwardRequest } from "./use-requests";

export function RequestForwardDialog({
  open,
  onOpenChange,
  requestId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: string;
}) {
  const t = useTranslations("pages.rcmV2.forward");
  const forward = useForwardRequest();
  const [staff, setStaff] = useState<Array<{ id: string; full_name: string; email: string | null }>>([]);
  const [toUserId, setToUserId] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    void fetchStaffForForward().then(setStaff);
  }, [open]);

  const items = useMemo<SearchSelectItem[]>(
    () =>
      staff.map((row) => ({
        value: row.id,
        label: row.full_name,
        keywords: [row.email ?? ""],
      })),
    [staff],
  );

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
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !forward.isPending && onOpenChange(next)}>
      <DialogContent
        className="flex w-[min(640px,96vw)] flex-col gap-0 overflow-visible rounded-xl p-0"
        showCloseButton={!forward.isPending}
        closeOutside
      >
        <div className="space-y-3 px-5 pb-4 pt-4">
          <div className="space-y-1.5">
            <Label>{t("staff")}</Label>
            <SearchSelect
              value={toUserId}
              onChange={(next) => setToUserId(next ?? "")}
              items={items}
              placeholder={t("staffPlaceholder")}
              recentsKey="request-forward-staff"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("note")}</Label>
            <Textarea className="min-h-16 text-sm" value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
        </div>
        <AppModalFooter title={t("title")} subtitle={t("subtitle")}>
          <Button type="button" variant="outline" className="h-9" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" className="h-9" disabled={forward.isPending} onClick={() => void submit()}>
            {forward.isPending ? <Loader2 className="me-1.5 size-3.5 animate-spin" /> : <Forward className="me-1.5 size-3.5" />}
            {t("submit")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
