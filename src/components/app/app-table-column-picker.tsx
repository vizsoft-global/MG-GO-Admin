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
import { ArrowDown, ArrowUp, Columns3, GripVertical } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { TableColumnVisibilityOption } from "@/hooks/use-table-column-visibility";

export function AppTableColumnPicker({
  options,
  isVisible,
  onToggle,
  onReset,
  onMove,
  onReorder,
  sourceLabel,
  hiddenCount = 0,
  className,
}: {
  options: TableColumnVisibilityOption[];
  isVisible: (id: string) => boolean;
  onToggle: (id: string) => void;
  onReset: () => void;
  onMove?: (id: string, dir: -1 | 1) => void;
  onReorder?: (activeId: string, overId: string) => void;
  sourceLabel?: string;
  hiddenCount?: number;
  className?: string;
}) {
  const t = useTranslations("common");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              className={cn(
                "inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-input bg-background px-2.5 text-xs font-medium hover:bg-accent sm:px-3",
                className,
              )}
              aria-label={t("columnsTooltip")}
            >
              <Columns3 className="h-4 w-4" />
              <span className="hidden 2xl:inline">{t("columns")}</span>
              {hiddenCount > 0 ? (
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                  {hiddenCount}
                </span>
              ) : null}
            </DropdownMenuTrigger>
          }
        />
        <TooltipContent>{t("columnsTooltip")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {t("columns")}
            {sourceLabel ? (
              <span className="ms-1 font-normal text-muted-foreground">
                · {sourceLabel}
              </span>
            ) : null}
          </DropdownMenuLabel>
          <ColumnOptionList
            options={options}
            isVisible={isVisible}
            onToggle={onToggle}
            onMove={onMove}
            onReorder={onReorder}
            sensors={sensors}
            dragLabel={t("dragColumn")}
          />
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer" onClick={onReset}>
          {t("resetColumns")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ColumnOptionList({
  options,
  isVisible,
  onToggle,
  onMove,
  onReorder,
  sensors,
  dragLabel,
}: {
  options: TableColumnVisibilityOption[];
  isVisible: (id: string) => boolean;
  onToggle: (id: string) => void;
  onMove?: (id: string, dir: -1 | 1) => void;
  onReorder?: (activeId: string, overId: string) => void;
  sensors: ReturnType<typeof useSensors>;
  dragLabel: string;
}) {
  const rows = options.map((option) => (
    <ColumnOptionRow
      key={option.id}
      option={option}
      checked={isVisible(option.id)}
      onToggle={onToggle}
      onMove={onMove}
      draggable={Boolean(onReorder)}
      dragLabel={dragLabel}
    />
  ));
  if (!onReorder) return rows;
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(event: DragEndEvent) => {
        const overId = event.over?.id;
        if (overId == null || event.active.id === overId) return;
        onReorder(String(event.active.id), String(overId));
      }}
    >
      <SortableContext items={options.map((option) => option.id)} strategy={verticalListSortingStrategy}>
        {rows}
      </SortableContext>
    </DndContext>
  );
}

function ColumnOptionRow({
  draggable,
  ...props
}: {
  option: TableColumnVisibilityOption;
  checked: boolean;
  onToggle: (id: string) => void;
  onMove?: (id: string, dir: -1 | 1) => void;
  draggable: boolean;
  dragLabel: string;
}) {
  if (draggable) return <SortableColumnOptionRow {...props} />;
  return <ColumnOptionBody {...props} />;
}

function SortableColumnOptionRow(
  props: {
    option: TableColumnVisibilityOption;
    checked: boolean;
    onToggle: (id: string) => void;
    onMove?: (id: string, dir: -1 | 1) => void;
    dragLabel: string;
  },
) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({
    id: props.option.id,
  });
  return (
    <ColumnOptionBody
      {...props}
      setNodeRef={setNodeRef}
      dragAttributes={attributes}
      dragListeners={listeners}
      style={{
        transform: CSS.Translate.toString(transform),
      }}
      isDragging={isDragging}
    />
  );
}

function ColumnOptionBody({
  option,
  checked,
  onToggle,
  onMove,
  dragLabel,
  setNodeRef,
  dragAttributes,
  dragListeners,
  style,
  isDragging,
}: {
  option: TableColumnVisibilityOption;
  checked: boolean;
  onToggle: (id: string) => void;
  onMove?: (id: string, dir: -1 | 1) => void;
  dragLabel: string;
  setNodeRef?: (node: HTMLElement | null) => void;
  dragAttributes?: ReturnType<typeof useSortable>["attributes"];
  dragListeners?: ReturnType<typeof useSortable>["listeners"];
  style?: { transform?: string };
  isDragging?: boolean;
}) {
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-0.5 pe-1 transition-transform duration-150 motion-reduce:transition-none",
        isDragging && "relative z-10 bg-popover",
      )}
    >
      {dragListeners ? (
        <button
          type="button"
          className="flex h-7 w-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted active:cursor-grabbing"
          aria-label={dragLabel}
          {...dragAttributes}
          {...dragListeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <DropdownMenuCheckboxItem
        checked={checked}
        onCheckedChange={() => onToggle(option.id)}
        className="min-w-0 flex-1 cursor-pointer"
      >
        {option.label}
      </DropdownMenuCheckboxItem>
      {onMove ? (
        <div className="flex shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onMove(option.id, -1);
            }}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onMove(option.id, 1);
            }}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
