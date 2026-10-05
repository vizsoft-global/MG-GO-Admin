"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ChevronLeft,
  ExternalLink,
  FileSignature,
  FileText,
  Fingerprint,
  Layers,
  PencilLine,
  Plus,
  Send,
  UserRoundPen,
  Users,
} from "lucide-react";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useEsignTemplates } from "@/features/esign/use-esign";
import type { EsignTemplateRow } from "@/features/esign/types";

type StatusTab = "all" | "active" | "draft" | "inactive";

/**
 * Tint by **document shape**, not by taxonomy.
 *
 * The reference's first chip is a classification badge, and the document kind is
 * the classification that changes what the sheet is: a penalty notice prints a
 * table, a loan agreement prints clauses, and both are a different artefact from
 * a plain acknowledgement. So the kind carries the colour and the category —
 * which is a filing label, and which every card would otherwise render as an
 * identical muted chip — carries the words.
 *
 * `general` is deliberately absent: it has no shape of its own, so a "General"
 * chip states nothing a reader did not already assume and the card omits it
 * rather than filling a slot with a non-fact.
 */
const KIND_TINT: Record<string, string> = {
  penalty: "border-rose-200 bg-rose-50 text-rose-800",
  loan: "border-indigo-200 bg-indigo-50 text-indigo-800",
};

/**
 * The template library, as a card grid.
 *
 * The reference presents templates as cards rather than table rows, and that is
 * the right shape here: the identity of a template is its *name plus its kind
 * plus how many fields it carries*, which is a small block of facts that reads
 * better as a card than as four narrow columns. The status tab is a
 * `ToggleChip` group so the palette matches every other filter in the panel, and
 * selected-versus-not survives the squint test.
 *
 * Cards open the V2 builder at `/employeedesk/esign/templates/[id]`. The V1 tree
 * at `/requests/esign/templates` still lists and edits the same rows through the
 * same RPCs — this screen is additive, not a replacement.
 */
export function TemplatesShell() {
  const t = useTranslations("pages.employeedesk.esign.templates");
  const router = useRouter();
  const { data, isLoading } = useEsignTemplates();
  const [tab, setTab] = useState<StatusTab>("all");

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const filtered = useMemo(() => {
    if (tab === "all") return rows;
    if (tab === "draft") return rows.filter((r) => r.is_draft);
    if (tab === "active") return rows.filter((r) => r.is_active && !r.is_draft);
    return rows.filter((r) => !r.is_active && !r.is_draft);
  }, [rows, tab]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      active: rows.filter((r) => r.is_active && !r.is_draft).length,
      draft: rows.filter((r) => r.is_draft).length,
      inactive: rows.filter((r) => !r.is_active && !r.is_draft).length,
    }),
    [rows],
  );

  return (
    <AppPage className="space-y-4">
      <AppPageHeader
        // The reference breadcrumb is two levels deep, not three: the module
        // itself is `Request & Complaint` and a template library is a child of
        // it. Inserting the E-Signature hub between them named a page the
        // operator did not come through and pushed the title off the line on a
        // 14" laptop, so the hub stays reachable from the sidebar and the crumb
        // chain states only where this screen sits.
        breadcrumbs={[
          { label: t("breadcrumbRcm"), href: "/employeedesk" },
          { label: t("title") },
        ]}
        title={t("title")}
        description={t("subtitle")}
        actions={
          <div className="flex items-center gap-2">
            {/* The reference pairs the primary builder entry with a link back
                to the queue the templates feed. An author who landed here from
                Outgoing had no way back except the sidebar. */}
            <Button
              size="sm"
              variant="outline"
              // Both pages that carry this control point at the same place, and
              // that is the point of it. It previously sent this one to the live
              // Sent queue and the bulk page to the template library, so the same
              // label had two destinations — the operator learned to distrust it.
              // `/employeedesk/esign` is the hub those two doors hang off, so the
              // label finally names where the button goes.
              onClick={() => router.push("/employeedesk/esign")}
            >
              {/* The reference writes the control as `< Back to Outgoing`, and
                  the chevron is load-bearing rather than decorative: without it
                  the button reads as a second navigation action beside "Create
                  from template" instead of as the page's exit. It mirrors under
                  RTL because the arrow points at the page's origin, not east. */}
              <ChevronLeft className="size-3.5 rtl:rotate-180" aria-hidden />
              {t("backToOutgoing")}
            </Button>
            <Button
              size="sm"
              onClick={() => router.push("/employeedesk/esign/templates/new")}
            >
              <Plus className="size-3.5" aria-hidden />
              {t("newTemplate")}
            </Button>
          </div>
        }
        tabs={
          <div className="flex flex-wrap gap-1.5">
            {(["all", "active", "draft", "inactive"] as StatusTab[]).map((key) => (
              <ToggleChip
                key={key}
                icon={key === "draft" ? PencilLine : FileSignature}
                selected={tab === key}
                onClick={() => setTab(key)}
              >
                {t(`tabs.${key}`)}
                <span className="ms-1 opacity-70">{counts[key]}</span>
              </ToggleChip>
            ))}
          </div>
        }
      />

      {data?.error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {t("loadFailed")}
        </p>
      ) : null}

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        // Framed rather than bare: a grid of cards that suddenly renders two
        // lines of grey text reads as a broken page, so the empty state keeps
        // the card's own border and carries the icon the catalog uses.
        <Card className="rounded-xl border-dashed border-border bg-card shadow-sm">
          <CardContent className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <span className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground">
              <FileSignature className="size-4" aria-hidden />
            </span>
            <AppEmptyState title={t("emptyTitle")} description={t("emptyBody")} />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((row) => (
            <TemplateCard
              key={row.id}
              row={row}
              categoryLabel={row.category_label ?? row.category_key}
              onOpen={() => router.push(`/employeedesk/esign/templates/${row.id}`)}
              labels={{
                fields: t("fieldCount", { count: row.field_count }),
                version: t("versionLabel", { version: row.version }),
                open: t("open"),
                banner: t("banner"),
                draft: t("statusDraft"),
                inactive: t("statusInactive"),
                active: t("statusActive"),
                employeeIdChip: t("chips.employeeId"),
                filledFromSystem: t("chips.filledFromSystem"),
                youEnter: t("chips.youEnter"),
                signatureRows: t("chips.signatureRows"),
                kinds: {
                  penalty: t("kinds.penalty"),
                  loan: t("kinds.loan"),
                },
              }}
            />
          ))}
        </div>
      )}
    </AppPage>
  );
}

function TemplateCard({
  row,
  categoryLabel,
  onOpen,
  labels,
}: {
  row: EsignTemplateRow;
  /** Operator-facing category name resolved from `esign_categories`. */
  categoryLabel: string;
  onOpen: () => void;
  labels: {
    fields: string;
    version: string;
    open: string;
    /** The reference's instruction chip that leads every card's chip row. */
    banner: string;
    draft: string;
    inactive: string;
    active: string;
    employeeIdChip: string;
    filledFromSystem: string;
    youEnter: string;
    signatureRows: string;
    kinds: Record<string, string>;
  };
}) {
  // Only the shaped kinds render a chip; see KIND_TINT.
  const kindTint = KIND_TINT[row.document_kind];
  const kindLabel = labels.kinds[row.document_kind];
  const status = row.is_draft
    ? { label: labels.draft, className: "border-amber-200 bg-amber-50 text-amber-800" }
    : row.is_active
      ? {
          label: labels.active,
          className: "border-emerald-200 bg-emerald-50 text-emerald-800",
        }
      : { label: labels.inactive, className: "border-border bg-muted/50 text-muted-foreground" };

  // A template is "filled from the system" when nothing in it has to be typed
  // per send. That is a claim about the whole document rather than about a row,
  // so it is derived once here instead of being stored — and it is deliberately
  // computed from the counts rather than from the kind, because a penalty
  // template with one hand-typed clause is not a system-filled template.
  const systemCount = row.source_counts?.system ?? 0;
  const entryCount = row.source_counts?.entry ?? 0;
  const filledFromSystem = systemCount > 0 && entryCount === 0;
  const provenance = filledFromSystem
    ? {
        label: labels.filledFromSystem,
        icon: Send,
        className: "border-sky-200 bg-sky-50 text-sky-800",
      }
    : {
        label: labels.youEnter,
        icon: UserRoundPen,
        className: "border-amber-200 bg-amber-50 text-amber-800",
      };
  const ProvenanceIcon = provenance.icon;

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer rounded-xl border-border shadow-sm transition-colors duration-150 hover:border-primary/40 hover:bg-primary/[0.03]"
    >
      <CardContent className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{row.name_en}</p>
            {row.name_ar ? (
              <p className="truncate text-[11px] text-muted-foreground" dir="rtl">
                {row.name_ar}
              </p>
            ) : null}
          </div>
          <span
            className={cn(
              "shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
              status.className,
            )}
          >
            {status.label}
          </span>
        </div>

        {/* The reference chip row, in its order: what the document is, the key
            it resolves on, and where its values come from. The key chip is not
            decoration — every row of a bulk sheet has to carry one, and naming
            it on the card is how an author knows which column to fill. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* The reference leads the chip row with the instruction rather than
              the taxonomy, and it is the right order: "you can send this to
              everyone at once" is the fact that decides whether a template is
              fit for a sheet, and it is true of every template in the library,
              so it reads as the row's constant against four variable chips. */}
          <span className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
            <Users className="size-3" aria-hidden />
            {labels.banner}
          </span>
          {/* Category follows, as the reference's classification chip does. It is
              a filing label rather than a state, so it stays neutral and lets
              the document kind beside it carry the colour. */}
          <span className="inline-flex min-w-0 items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            <Layers className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{categoryLabel}</span>
          </span>
          {/* Rendered only when the kind actually changes the sheet. A card that
              prints "General" next to a General kind is a chip restating the
              default, and ten identical chips across the library read as noise
              the reader has to filter before reaching the two that matter. */}
          {kindTint && kindLabel ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                kindTint,
              )}
            >
              <FileText className="size-3" aria-hidden />
              {kindLabel}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
            <Fingerprint className="size-3" aria-hidden />
            {labels.employeeIdChip}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              provenance.className,
            )}
          >
            <ProvenanceIcon className="size-3" aria-hidden />
            {provenance.label}
          </span>
          {row.has_signature_rows ? (
            <Badge variant="outline" className="text-[10px] font-normal">
              {labels.signatureRows}
            </Badge>
          ) : null}
        </div>

        <div className="mt-auto flex items-center justify-between border-t border-border pt-2">
          {/* Version and field count are metadata, not chip vocabulary: the
              reference has no "12 fields" pill, and printing one beside a
              provenance chip made two different kinds of fact look alike. They
              read as one line of small print instead. */}
          <span className="text-[10px] text-muted-foreground">
            {labels.version} · {labels.fields}
          </span>
          {/* View/open is an information action, so it carries the primary
              treatment + ExternalLink-style icon per the action rulebook. */}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-primary hover:bg-primary/10"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
          >
            <ExternalLink className="size-3.5" aria-hidden />
            {labels.open}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
