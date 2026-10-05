"use client";

import { useTranslations } from "next-intl";
import {
  CheckCircle2,
  Lock,
  PenLine,
  Send,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FIELD_SOURCE_META } from "@/features/esign/template-source";
import type { EsignFieldSource } from "@/features/esign/types";

const SOURCE_ICON: Record<EsignFieldSource, LucideIcon> = {
  system: Send,
  entry: PenLine,
  fixed: Lock,
  signature: CheckCircle2,
};

/**
 * The source badge on a template field row.
 *
 * The reference design carries one of these on **every** field row, and it is
 * the badge — not the control type — that tells an author where a value comes
 * from. It is rendered as a chip with a Lucide icon per the panel's iconography
 * rule, and the tint comes from `FIELD_SOURCE_META` so the builder list and the
 * document preview cannot disagree about what a row means.
 */
export function FieldSourceBadge({
  source,
  className,
}: {
  source: EsignFieldSource;
  className?: string;
}) {
  const t = useTranslations("pages.employeedesk.esign.templateBuilder.sources");
  const meta = FIELD_SOURCE_META[source];
  const Icon = SOURCE_ICON[source];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold leading-4",
        meta.className,
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {t(meta.labelKey)}
    </span>
  );
}
