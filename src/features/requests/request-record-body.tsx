"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Car, Check, FileText, User } from "lucide-react";
import { SectionHeading } from "@/features/drivers/form/driver-form-primitives";

/** Same card grid as the fuel / refund / asset request popup. */
export function RequestRecordBody({
  requester,
  summary,
  employee,
  vehicle,
  fields,
  evidence,
  approval,
  side,
}: {
  requester: ReactNode;
  summary?: ReactNode;
  employee: ReactNode;
  vehicle: ReactNode;
  fields: ReactNode;
  evidence: ReactNode;
  approval: ReactNode;
  side?: ReactNode;
}) {
  const fleetT = useTranslations("pages.fleetFuelQueue");
  const requestT = useTranslations("pages.requests");

  return (
    <>
      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">{requester}</div>
      {summary ? (
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs font-medium">{summary}</div>
      ) : null}
      <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
        <div className="h-full min-w-0 rounded-xl border border-border bg-card p-3 shadow-sm">
          <SectionHeading icon={User} accent="primary">
            {fleetT("sectionEmployee")}
          </SectionHeading>
          <div className="mt-1">{employee}</div>
        </div>
        <div className="h-full min-w-0 rounded-xl border border-border bg-card p-3 shadow-sm">
          <SectionHeading icon={Car} accent="primary">
            {fleetT("sectionVehicle")}
          </SectionHeading>
          <div className="mt-1">{vehicle}</div>
        </div>
      </div>
      <div className="grid gap-2 lg:grid-cols-[1.1fr_0.9fr] lg:items-stretch">
        <div className="flex h-full flex-col gap-2">
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <SectionHeading icon={FileText} accent="primary">
              {requestT("detail.fields")}
            </SectionHeading>
            <div className="mt-1">{fields}</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <SectionHeading icon={FileText} accent="success">
              {fleetT("fieldEvidence")}
            </SectionHeading>
            <div className="mt-2">{evidence}</div>
          </div>
        </div>
        <div className="flex h-full min-w-0 flex-col gap-2">
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <SectionHeading icon={Check} accent="warning">
              {requestT("detail.approval")}
            </SectionHeading>
            <div className="mt-2">{approval}</div>
          </div>
          {side}
        </div>
      </div>
    </>
  );
}
