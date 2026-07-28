"use client";

import { Activity, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { SegmentOption, ToggleChip } from "@/components/app/toggle-chip";
import { AssetCatalogIcon } from "@/features/assets/asset-catalog-icon";
import type { DriverFormCatalogItem } from "@/features/assets/types";
import type { DriverWorkflowStatus } from "../types";
import { SectionHeading } from "./driver-form-primitives";

const STATUS_OPTIONS: Array<{
  id: "active" | "inactive";
  key: "active" | "inactive";
}> = [
  { id: "active", key: "active" },
  { id: "inactive", key: "inactive" },
];

export function DriverFormOperationsCard({
  workflowStatus,
  onWorkflowStatusChange,
  catalogItems,
  selectedCatalogIds,
  onToggleCatalogItem,
  labels,
  disabled,
  catalogLoading,
  emptyCatalogHint,
  linked = false,
}: {
  workflowStatus: DriverWorkflowStatus;
  onWorkflowStatusChange: (status: DriverWorkflowStatus) => void;
  catalogItems: DriverFormCatalogItem[];
  selectedCatalogIds: Set<string>;
  onToggleCatalogItem: (catalogItemId: string) => void;
  labels: {
    section: string;
    status: string;
    assets: string;
    active: string;
    inactive: string;
  };
  disabled?: boolean;
  catalogLoading?: boolean;
  emptyCatalogHint?: string;
  linked?: boolean;
}) {
  const tNew = useTranslations("pages.driverNew");
  const activeStatus = workflowStatus === "draft" ? "inactive" : "active";

  return (
    <section className="flex h-full flex-col space-y-3 rounded-lg border border-border bg-card p-4">
      <SectionHeading icon={Activity} accent="warning">
        {labels.section}
      </SectionHeading>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-foreground">{labels.status}</p>
        <div role="radiogroup" className="grid grid-cols-2 gap-1.5">
          {STATUS_OPTIONS.map((option) => {
            const checked = option.id === activeStatus;
            return (
              <SegmentOption
                key={option.id}
                selected={checked}
                disabled={disabled}
                variant={option.key === "active" ? "success" : "default"}
                onClick={() =>
                  onWorkflowStatusChange(
                    option.key === "active"
                      ? linked
                        ? "approved"
                        : "pending"
                      : "draft",
                  )
                }
              >
                {option.key === "active" ? labels.active : labels.inactive}
              </SegmentOption>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-foreground">{labels.assets}</p>
        {catalogLoading ? (
          <div className="flex h-16 items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : catalogItems.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">{emptyCatalogHint}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {catalogItems.map((item) => {
              const selected = selectedCatalogIds.has(item.id);
              const outOfStock = item.available_qty < 1 && !selected;
              return (
                <ToggleChip
                  key={item.id}
                  selected={selected}
                  disabled={disabled || outOfStock}
                  leading={
                    <AssetCatalogIcon
                      iconKey={item.icon_key}
                      imageUrl={item.image_url}
                      imgClassName="h-full w-full object-contain"
                      iconClassName="h-3 w-3"
                    />
                  }
                  onClick={() => onToggleCatalogItem(item.id)}
                >
                  {item.name} ({tNew("assetsAvailable", { count: item.available_qty })})
                </ToggleChip>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
