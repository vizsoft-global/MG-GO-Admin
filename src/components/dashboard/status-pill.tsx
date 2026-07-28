import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const statusPillVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
  {
    variants: {
      variant: {
        success: "bg-success-bg text-success",
        warning: "bg-warning-bg text-warning",
        danger: "bg-danger-bg text-danger",
        neutral: "bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export function StatusPill({
  children,
  variant,
  className,
  dot = false,
}: VariantProps<typeof statusPillVariants> & {
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span className={cn(statusPillVariants({ variant }), className)}>
      {dot ? (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            variant === "success" && "bg-success",
            variant === "warning" && "bg-warning",
            variant === "danger" && "bg-danger",
            variant === "neutral" && "bg-muted-foreground",
          )}
        />
      ) : null}
      {children}
    </span>
  );
}
