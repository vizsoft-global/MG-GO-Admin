"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AppFormSection } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateVehicleTypeLabel } from "./vehicles-actions";
import type { VehicleTypeRow } from "./types";

export function VehicleTypesPanel({ types }: { types: VehicleTypeRow[] }) {
  const t = useTranslations("pages.settings.vehicleTypes");
  const [pending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, { label_en: string; label_ar: string }>>(
    () =>
      Object.fromEntries(types.map((type) => [type.key, { label_en: type.label_en, label_ar: type.label_ar }])),
  );

  return (
    <AppFormSection title={t("title")} description={t("subtitle")}>
      <div className="space-y-3">
        {types.map((type) => {
          const draft = drafts[type.key] ?? type;
          return (
            <form
              key={type.key}
              className="grid gap-2 rounded-xl border border-border bg-card p-4 sm:grid-cols-[120px_1fr_1fr_auto] sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                const formData = new FormData();
                formData.set("key", type.key);
                formData.set("labelEn", draft.label_en);
                formData.set("labelAr", draft.label_ar);
                startTransition(async () => {
                  const result = await updateVehicleTypeLabel(formData);
                  if (result.error) {
                    toast.error(t("saveFailed"));
                    return;
                  }
                  toast.success(t("saved"));
                });
              }}
            >
              <div>
                <Label>{t("key")}</Label>
                <p className="mt-1.5 text-sm font-semibold">{type.key}</p>
              </div>
              <div className="space-y-1.5">
                <Label>{t("labelEn")}</Label>
                <Input
                  className="h-9"
                  value={draft.label_en}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [type.key]: { ...draft, label_en: event.target.value },
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("labelAr")}</Label>
                <Input
                  className="h-9"
                  dir="rtl"
                  value={draft.label_ar}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [type.key]: { ...draft, label_ar: event.target.value },
                    }))
                  }
                />
              </div>
              <Button type="submit" className="h-9" disabled={pending}>
                {t("save")}
              </Button>
            </form>
          );
        })}
      </div>
    </AppFormSection>
  );
}
