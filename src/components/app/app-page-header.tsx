import type { ReactNode } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";

export type AppBreadcrumbItem = {
  label: string;
  href?: string;
};

export function AppPageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  tabs,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumbs?: AppBreadcrumbItem[];
  tabs?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumbs.map((item, i) => (
              <span key={`${item.label}-${i}`} className="contents">
                {i > 0 ? <BreadcrumbSeparator /> : null}
                <BreadcrumbItem>
                  {item.href && i < breadcrumbs.length - 1 ? (
                    <BreadcrumbLink href={item.href}>{item.label}</BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{item.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </span>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {tabs}
    </div>
  );
}
