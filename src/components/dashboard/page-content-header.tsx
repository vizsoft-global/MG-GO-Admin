import type { ReactNode } from "react";
import { AppPageHeader } from "@/components/app/app-page-header";

/** @deprecated Prefer AppPageHeader from @/components/app */
export function PageContentHeader({
  title,
  subtitle,
  actions,
  tabs,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <AppPageHeader
      title={title}
      description={subtitle}
      actions={actions}
      tabs={tabs}
    />
  );
}
