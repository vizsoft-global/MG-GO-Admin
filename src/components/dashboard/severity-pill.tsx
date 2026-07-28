import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const severityVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
  {
    variants: {
      severity: {
        high: "bg-danger-bg text-danger",
        medium: "bg-warning-bg text-warning",
        low: "bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      severity: "low",
    },
  },
);

export function SeverityPill({
  children,
  severity,
  className,
}: VariantProps<typeof severityVariants> & {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(severityVariants({ severity }), className)}>{children}</span>
  );
}
