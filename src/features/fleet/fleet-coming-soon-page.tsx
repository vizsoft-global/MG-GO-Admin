"use client";

import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";

export function FleetComingSoonPage({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <AppPage>
      <AppPageHeader title={title} description={subtitle} />
      <AppListCard>
        <AppEmptyState
          title={title}
          description="Coming soon — this Fleet page is stubbed until its data UI ships."
        />
        <p className="px-4 pb-4 text-center">
          <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
            Coming soon
          </span>
        </p>
      </AppListCard>
    </AppPage>
  );
}
