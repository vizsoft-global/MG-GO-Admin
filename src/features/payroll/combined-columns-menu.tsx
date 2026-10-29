"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Check, Columns3, GripVertical, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { CombinedColumnsController } from "./use-combined-columns";

/**
 * The Combined Payroll Columns menu (SOP item 8).
 *
 * Order and visibility are the operator's own, saved per staff member. The pinned
 * MG ID · Driver ID · Name trio cannot be hidden or moved, so the menu says so
 * once instead of offering three checkboxes that would silently refuse.
 */
export function CombinedColumnsMenu({
  columns,
  labelFor,
  canManage,
  trailing,
}: {
  columns: CombinedColumnsController;
  labelFor: (columnId: string) => string;
  /** Rename is `payroll.manage`; visibility and order are everyone's own. */
  canManage: boolean;
  trailing?: ReactNode;
}) {
  const t = useTranslations("pages.payroll.combinedColumns");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    columns.reorder(String(active.id), String(over.id));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {trailing}
      <Popover>
        <PopoverTrigger className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2 text-xs font-semibold hover:bg-muted/50">
          <Columns3 className="size-3.5" />
          {t("columns")}
          <span className="rounded-sm bg-muted px-1 tabular-nums text-muted-foreground">
            {t("count", { count: columns.visibleCount })}
          </span>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(320px,94vw)] origin-(--transform-origin) p-3">
          <p className="text-xs font-semibold">{t("title")}</p>
          <p className="mb-2 text-xs text-muted-foreground">{t("hint")}</p>
          <p className="mb-2 rounded-md bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
            {t("pinned")}
          </p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={columns.order} strategy={verticalListSortingStrategy}>
              <div className="max-h-72 space-y-0.5 overflow-y-auto pe-1">
                {columns.order.map((id) => (
                  <CombinedColumnRow
                    key={id}
                    id={id}
                    label={labelFor(id)}
                    checked={columns.isVisible(id)}
                    onToggle={columns.toggle}
                    onMove={columns.move}
                    dragLabel={t("drag")}
                    showLabel={t("show")}
                    hideLabel={t("hide")}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
            {canManage ? (
              <span className="text-xs text-muted-foreground">{t("renameHint")}</span>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={columns.reset}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs font-semibold hover:bg-muted/50"
            >
              <RotateCcw className="size-3" />
              {t("reset")}
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function CombinedColumnRow({
  id,
  label,
  checked,
  onToggle,
  onMove,
  dragLabel,
  showLabel,
  hideLabel,
}: {
  id: string;
  label: string;
  checked: boolean;
  onToggle: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  dragLabel: string;
  showLabel: string;
  hideLabel: string;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        "flex items-center gap-0.5 rounded-sm pe-0.5 transition-transform duration-150 motion-reduce:transition-none",
        isDragging && "relative z-10 bg-popover",
      )}
    >
      <button
        type="button"
        className="flex h-7 w-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted active:cursor-grabbing"
        aria-label={dragLabel}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" />
      </button>
      <button
        type="button"
        aria-pressed={checked}
        aria-label={checked ? hideLabel : showLabel}
        onClick={() => onToggle(id)}
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded-sm border",
          checked
            ? "border-emerald-500 bg-emerald-500 text-white"
            : "border-border bg-muted/30 text-transparent",
        )}
      >
        <Check className="size-3" />
      </button>
      <span className="min-w-0 flex-1 truncate ps-1.5 text-xs font-medium">{label}</span>
      <button
        type="button"
        aria-label={`${label} ↑`}
        onClick={() => onMove(id, -1)}
        className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ArrowUp className="size-3" />
      </button>
      <button
        type="button"
        aria-label={`${label} ↓`}
        onClick={() => onMove(id, 1)}
        className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ArrowDown className="size-3" />
      </button>
    </div>
  );
}
