"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Inbox, Send } from "lucide-react";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { useEsignStatusCounts } from "@/features/esign/use-esign";
import { useRequestTypeCounts } from "./use-requests";

type Wash = "tile" | "sick" | "esign";

type TypeTile = {
  type: string;
  href: string;
  icon: string;
  color: string;
  wash?: Wash;
};

const TYPE_TILES: TypeTile[] = [
  { type: "leave", href: "/requests/overview?type=leave&preset=all", icon: "/hub/leave.svg", color: "bg-[#0f9d8a]" },
  { type: "asset", href: "/requests/overview?type=asset&preset=all", icon: "/hub/asset.svg", color: "bg-[#7c3aed]" },
  { type: "fuel", href: "/requests/overview?type=fuel&preset=all", icon: "/hub/fuel.svg", color: "bg-[#ea580c]" },
  { type: "fuel_refund", href: "/requests/overview?type=fuel_refund&preset=all", icon: "/hub/fuel.svg", color: "bg-[#ca8a04]" },
  { type: "loan", href: "/requests/overview?type=loan&preset=all", icon: "/hub/loan.svg", color: "bg-[#2563eb]" },
  { type: "complaint", href: "/requests/overview?type=complaint&preset=all", icon: "/hub/complaint.svg", color: "bg-[#db2777]" },
  { type: "document", href: "/requests/overview?type=document&preset=all", icon: "/hub/documents.svg", color: "bg-[#4f46e5]" },
  { type: "salary_justification", href: "/requests/overview?type=salary_justification&preset=all", icon: "/hub/salary.svg", color: "bg-[#d25335]" },
  { type: "sick_leave", href: "/requests/overview?type=sick_leave&preset=all", icon: "/hub/sick.svg", color: "bg-[#d25335]", wash: "sick" },
];

type OpTile = {
  href: string;
  labelKey: "hub.esign" | "hub.all" | "hub.reports" | "hub.audit" | "hub.settings";
  icon: string;
  color: string;
  wash?: Wash;
  countKey?: "all" | "esign";
};

type SenderTile = {
  href: string;
  labelKey:
    | "hub.senderTemplates"
    | "hub.senderSend"
    | "hub.senderBulk"
    | "hub.senderSent"
    | "hub.senderBatches";
  icon: string;
  color: string;
};

const SENDER_TILES: SenderTile[] = [
  { href: "/requests/esign/templates", labelKey: "hub.senderTemplates", icon: "/hub/documents.svg", color: "bg-[#4f46e5]" },
  { href: "/requests/esign/send", labelKey: "hub.senderSend", icon: "/hub/esign.svg", color: "bg-[#0f766e]", },
  { href: "/requests/esign/bulk", labelKey: "hub.senderBulk", icon: "/hub/all.svg", color: "bg-[#2563eb]" },
  { href: "/requests/esign/sent", labelKey: "hub.senderSent", icon: "/hub/audit.svg", color: "bg-[#0891b2]" },
  { href: "/requests/esign/batches", labelKey: "hub.senderBatches", icon: "/hub/reports.svg", color: "bg-[#7c3aed]" },
];

const OP_TILES: OpTile[] = [
  { href: "/requests?view=sender", labelKey: "hub.esign", icon: "/hub/esign.svg", color: "bg-[#0f766e]", wash: "esign", countKey: "esign" },
  { href: "/requests/overview?preset=all", labelKey: "hub.all", icon: "/hub/all.svg", color: "bg-[#0f766e]", countKey: "all" },
  { href: "/requests/reports", labelKey: "hub.reports", icon: "/hub/reports.svg", color: "bg-[#0891b2]" },
  { href: "/requests/settings/audit", labelKey: "hub.audit", icon: "/hub/audit.svg", color: "bg-[#64748b]" },
  { href: "/requests/settings", labelKey: "hub.settings", icon: "/hub/settings.svg", color: "bg-[#65a30d]" },
];

function TileWash({ wash }: { wash: Wash }) {
  if (wash === "sick") {
    return <span className="absolute inset-0 bg-gradient-to-r from-[#fb7185] to-[#be123c]" />;
  }
  if (wash === "esign") {
    return <span className="absolute inset-0 bg-gradient-to-r from-[#a78bfa] to-[#6d28d9]" />;
  }
  return (
    <span className="absolute inset-0 bg-[linear-gradient(131deg,rgba(255,255,255,0.22)_0%,rgba(255,255,255,0)_36%,rgba(0,0,0,0.14)_71%)]" />
  );
}

function HubTile({
  href,
  icon,
  color,
  wash = "tile",
  label,
  count,
}: {
  href: string;
  icon: string;
  color: string;
  wash?: Wash;
  label: string;
  count?: number;
}) {
  return (
    <Link
      href={href}
      className="relative flex h-[148px] w-[112px] flex-col items-center justify-center gap-3 transition-opacity duration-150 hover:opacity-90 active:scale-[0.97]"
    >
      <span
        className={cn(
          "relative size-24 shrink-0 overflow-hidden rounded-[20px] shadow-[0_8px_16px_rgba(0,0,0,0.3)]",
          color,
        )}
      >
        <TileWash wash={wash} />
        <img
          src={icon}
          alt=""
          width={40}
          height={40}
          className="absolute left-1/2 top-1/2 size-10 -translate-x-1/2 -translate-y-1/2 object-contain"
        />
      </span>
      <span className="h-[34px] w-full break-words text-center text-[13px] font-medium leading-[normal] text-[#f4f4f5]">
        {label}
      </span>
      {count != null && count > 0 ? (
        <span className="absolute -top-[2.5px] end-2 inline-flex items-center justify-center overflow-hidden rounded-full border border-[#f6e5c3] bg-[#fffaeb] px-[7px] py-0.5 text-xs font-semibold leading-none text-[#b54708]">
          {count > 999 ? "999+" : count}
        </span>
      ) : null}
    </Link>
  );
}

export function RequestsHubShell() {
  const t = useTranslations("pages.requests");
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = searchParams.get("view") === "sender" ? "sender" : "receiver";
  const { data } = useRequestTypeCounts();
  const { data: esignCounts } = useEsignStatusCounts();
  const counts = data?.counts ?? {};
  const totalPending = Object.values(counts).reduce((sum, c) => sum + c.pending, 0);

  return (
    <div className="-m-3 flex min-h-[calc(100%+1.5rem)] flex-col bg-gradient-to-b from-[#2a2a40] via-[#35354f] via-[55%] to-[#1f1f32]">
      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-12 py-8">
        <header className="flex flex-col items-center gap-2 text-center">
          <div className="mb-1 flex items-center gap-1.5">
            <ToggleChip
              selected={view === "receiver"}
              onClick={() => router.replace("/requests?view=receiver")}
              icon={Inbox}
            >
              {t("hub.receiver")}
            </ToggleChip>
            <ToggleChip
              selected={view === "sender"}
              onClick={() => router.replace("/requests?view=sender")}
              icon={Send}
            >
              {t("hub.sender")}
            </ToggleChip>
          </div>
          <h1 className="text-[30px] font-semibold leading-none text-white">
            {view === "sender" ? t("hub.senderTitle") : t("hub.title")}
          </h1>
          <p className="text-sm text-[#c4c4ce]">
            {view === "sender" ? t("hub.senderSubtitle") : t("hub.subtitle")}
          </p>
        </header>

        {view === "sender" ? (
          <section className="flex flex-col items-center gap-[18px]">
            <h2 className="text-[11px] font-semibold uppercase tracking-[1px] text-[#9ca3af]">
              {t("hub.senderHeading")}
            </h2>
            <div className="flex w-[min(631px,100%)] flex-wrap content-start items-start justify-center gap-x-5 gap-y-6">
              {SENDER_TILES.map((tile) => (
                <HubTile
                  key={tile.href}
                  href={tile.href}
                  icon={tile.icon}
                  color={tile.color}
                  wash="esign"
                  label={t(tile.labelKey)}
                />
              ))}
            </div>
          </section>
        ) : (
          <>
        <section className="flex flex-col items-center gap-[18px]">
          <h2 className="text-[11px] font-semibold uppercase tracking-[1px] text-[#9ca3af]">
            {t("hub.requestTypesHeading")}
          </h2>
          <div className="flex w-[min(631px,100%)] flex-wrap content-start items-start justify-center gap-x-5 gap-y-6">
            {TYPE_TILES.map((tile) => (
              <HubTile
                key={tile.type}
                href={tile.href}
                icon={tile.icon}
                color={tile.color}
                wash={tile.wash}
                label={t(`hub.${tile.type}` as "hub.leave")}
                count={counts[tile.type]?.pending}
              />
            ))}
          </div>
        </section>

        <section className="flex flex-col items-center gap-[18px]">
          <h2 className="text-[11px] font-semibold uppercase tracking-[1px] text-[#9ca3af]">
            {t("hub.operationsHeading")}
          </h2>
          <div className="flex w-[min(780px,100%)] flex-wrap content-start items-start justify-center gap-x-5 gap-y-6">
            {OP_TILES.map((tile) => (
              <HubTile
                key={tile.href}
                href={tile.href}
                icon={tile.icon}
                color={tile.color}
                wash={tile.wash}
                label={t(tile.labelKey)}
                count={
                  tile.countKey === "all"
                    ? totalPending
                    : tile.countKey === "esign"
                      ? esignCounts?.pending
                      : undefined
                }
              />
            ))}
          </div>
        </section>
          </>
        )}
      </div>
    </div>
  );
}
