"use client";

import type { ReactNode } from "react";
import { AppPage } from "./app-page";
import { AppPageHeader } from "./app-page-header";
import { AppListCard } from "./app-list-card";
import { AppListToolbar } from "./app-list-toolbar";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "./app-data-table";
import { AppEmptyState } from "./app-empty-state";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { TabBar, type TabItem } from "@/components/dashboard/tab-bar";
import { Skeleton } from "@/components/ui/skeleton";

export function ModuleIndexPage({
  title,
  subtitle,
  actions,
  tabs,
  activeTabId,
  onTabSelect,
  kpis,
  columns,
  emptyTitle,
  emptyDescription,
  toolbarTrailing,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  tabs?: TabItem[];
  activeTabId?: string;
  onTabSelect?: (id: string) => void;
  kpis: { label: string; value: string | number }[];
  columns: string[];
  emptyTitle: string;
  emptyDescription?: string;
  toolbarTrailing?: ReactNode;
}) {
  const tableColumns = columns.map((label, i) => ({
    id: `col-${i}`,
    label,
  }));

  return (
    <AppPage>
      <AppPageHeader
        title={title}
        description={subtitle}
        actions={actions}
      />
      {tabs && activeTabId && (
        <TabBar
          items={tabs}
          activeId={activeTabId}
          onSelect={onTabSelect}
        />
      )}
      <KpiGrid items={kpis} />
      <AppListCard
        toolbar={
          <AppListToolbar trailing={toolbarTrailing} />
        }
      >
        <AppDataTable columns={tableColumns}>
          {Array.from({ length: 5 }).map((_, i) => (
            <AppDataTableRow key={i}>
              {columns.map((col) => (
                <TableCell key={col}>
                  <Skeleton className="h-4 w-full max-w-[140px]" />
                </TableCell>
              ))}
            </AppDataTableRow>
          ))}
        </AppDataTable>
        <AppDataTableEmpty>
          <AppEmptyState title={emptyTitle} description={emptyDescription} />
        </AppDataTableEmpty>
      </AppListCard>
    </AppPage>
  );
}
