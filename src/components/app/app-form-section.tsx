import type { ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function AppFormSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("rounded-xl border-border bg-card shadow-sm", className)}>
      {title ? (
        <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div className="space-y-1">
            <CardTitle className="text-base font-semibold tracking-tight">
              {title}
            </CardTitle>
            {description ? (
              <CardDescription>{description}</CardDescription>
            ) : null}
          </div>
          {action}
        </CardHeader>
      ) : null}
      <CardContent className="px-6 py-5">{children}</CardContent>
    </Card>
  );
}
