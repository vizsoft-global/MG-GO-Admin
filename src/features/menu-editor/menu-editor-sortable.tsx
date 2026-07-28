"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

export type SortableHandleProps = {
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
};

export function orderEntryId(entry: { kind: "group" | "item"; id: string }) {
  return `order:${entry.kind}:${entry.id}`;
}

export function rowItemId(itemId: string) {
  return `row:${itemId}`;
}

export function SortableDragHandle({
  className,
  title,
  listeners,
  attributes,
}: {
  className?: string;
  title?: string;
  listeners?: ReturnType<typeof useSortable>["listeners"];
  attributes?: ReturnType<typeof useSortable>["attributes"];
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex shrink-0 cursor-grab touch-none items-center rounded p-0.5 text-muted-foreground hover:bg-muted active:cursor-grabbing",
        className,
      )}
      title={title}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-3.5" aria-hidden />
    </button>
  );
}

export function SortableShell({
  id,
  children,
  className,
}: {
  id: string;
  children: (props: {
    attributes: ReturnType<typeof useSortable>["attributes"];
    listeners: ReturnType<typeof useSortable>["listeners"];
    isDragging: boolean;
  }) => ReactNode;
  className?: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && "z-10 opacity-90", className)}
    >
      {children({ attributes, listeners, isDragging })}
    </div>
  );
}

export function MenuEditorDndProvider({
  sortableIds,
  onOrderDragEnd,
  onRowDragEnd,
  children,
}: {
  sortableIds: string[];
  onOrderDragEnd: (activeId: string, overId: string) => void;
  onRowDragEnd: (activeId: string, overId: string) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId.startsWith("order:") && overId.startsWith("order:")) {
      onOrderDragEnd(activeId, overId);
      return;
    }
    if (activeId.startsWith("row:") && overId.startsWith("row:")) {
      onRowDragEnd(activeId, overId);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

export function reorderById<T>(
  items: T[],
  activeId: string,
  overId: string,
  getId: (item: T) => string,
): T[] {
  const oldIndex = items.findIndex((item) => getId(item) === activeId);
  const newIndex = items.findIndex((item) => getId(item) === overId);
  if (oldIndex < 0 || newIndex < 0) return items;
  return arrayMove(items, oldIndex, newIndex);
}
