import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors duration-150 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
        "portal-green":
          "h-[22px] gap-1.5 rounded-full border-transparent bg-[var(--portal-badge-green-bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--portal-badge-green-fg)] before:size-1.5 before:shrink-0 before:rounded-full before:bg-current",
        "portal-blue":
          "h-[22px] gap-1.5 rounded-full border-transparent bg-[var(--portal-badge-blue-bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--portal-badge-blue-fg)] before:size-1.5 before:shrink-0 before:rounded-full before:bg-current",
        "portal-red":
          "h-[22px] gap-1.5 rounded-full border-transparent bg-[var(--portal-badge-red-bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--portal-badge-red-fg)] before:size-1.5 before:shrink-0 before:rounded-full before:bg-current",
        "portal-ochre":
          "h-[22px] gap-1.5 rounded-full border-transparent bg-[var(--portal-badge-ochre-bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--portal-badge-ochre-fg)] before:size-1.5 before:shrink-0 before:rounded-full before:bg-current",
        "portal-grey":
          "h-[22px] gap-1.5 rounded-full border-transparent bg-[var(--portal-badge-grey-bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--portal-badge-grey-fg)] before:size-1.5 before:shrink-0 before:rounded-full before:bg-current",
        "portal-plum":
          "h-[22px] gap-1.5 rounded-full border-transparent bg-[var(--portal-badge-plum-bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--portal-badge-plum-fg)] before:size-1.5 before:shrink-0 before:rounded-full before:bg-current",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
