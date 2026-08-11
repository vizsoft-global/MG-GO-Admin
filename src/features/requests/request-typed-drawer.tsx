"use client";

import { PanelRightOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { RequestAttachment, RequestDetail } from "./types";

type Field = { key: string; label: string; from?: "payload" | "column" };

/** Figma §2 field matrices — keys must match driver payload / shared columns. */
const TYPE_FIELDS: Record<string, Field[]> = {
  leave: [
    { key: "leave_type", label: "Leave type" },
    { key: "start_date", label: "From", from: "column" },
    { key: "end_date", label: "To", from: "column" },
    { key: "comment", label: "Comment" },
    { key: "justification", label: "Justification" },
    { key: "declaration_accepted", label: "Declaration" },
  ],
  sick_leave: [
    { key: "leave_subtype", label: "Leave type" },
    { key: "start_date", label: "From", from: "column" },
    { key: "end_date", label: "To", from: "column" },
    { key: "comment", label: "Comment" },
    { key: "symptoms_details", label: "Symptoms / details" },
  ],
  loan: [
    { key: "amount_kwd", label: "Amount (KWD)", from: "column" },
    { key: "tenure_months", label: "Tenure" },
    { key: "needed_by", label: "Needed by" },
    { key: "reason", label: "Reason" },
    { key: "declaration_accepted", label: "Declaration" },
  ],
  asset: [
    { key: "asset_type", label: "Asset type" },
    { key: "size", label: "Size" },
    { key: "quantity", label: "Quantity" },
    { key: "request_mode", label: "Renewal / First Time" },
    { key: "asset_current_status", label: "Current status" },
    { key: "justification", label: "Justification" },
    { key: "declaration_accepted", label: "Declaration" },
  ],
  fuel: [
    { key: "amount_kwd", label: "Amount (KWD)", from: "column" },
    { key: "period_month", label: "Period" },
    { key: "distance_km", label: "Distance (km)" },
  ],
  document: [
    { key: "document_type", label: "Document type" },
    { key: "language", label: "Language" },
    { key: "needed_by", label: "Needed by" },
    { key: "delivery_method", label: "Delivery method" },
    { key: "comment", label: "Comment" },
  ],
  complaint: [
    { key: "category", label: "Category" },
    { key: "severity", label: "Severity", from: "column" },
    { key: "subject", label: "Subject" },
    { key: "description", label: "Description" },
  ],
  salary_justification: [
    { key: "salary_month", label: "Salary Month" },
    { key: "expected_amount", label: "Expected amount" },
    { key: "received_amount", label: "Received amount" },
    { key: "comment", label: "Comment" },
    { key: "justification", label: "Justification" },
  ],
};

function formatValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.map(formatValue).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function statusVariant(
  status: string,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "approved" || status === "solved") return "success";
  if (status === "rejected") return "danger";
  if (status === "needs_clarification" || status === "overdue") return "warning";
  return "neutral";
}

function readField(request: RequestDetail, field: Field): unknown {
  if (field.from === "column") {
    if (field.key === "amount_kwd") return request.amount_kwd;
    if (field.key === "start_date") return request.start_date;
    if (field.key === "end_date") return request.end_date;
    if (field.key === "severity") return request.severity;
  }
  return request.payload?.[field.key];
}

export function RequestTypedDrawer({
  request,
  attachments,
}: {
  request: RequestDetail;
  attachments: RequestAttachment[];
}) {
  const t = useTranslations("pages.requests");
  const typed = TYPE_FIELDS[request.request_type] ?? [];
  const rows = typed
    .map((field) => ({
      label: field.label,
      value: formatValue(readField(request, field)),
    }))
    .filter((row) => row.value !== "—");

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm" className="h-9" />
        }
      >
        <PanelRightOpen className="me-1.5 h-3.5 w-3.5" />
        {t("detail.viewDrawer")}
      </DialogTrigger>
      <DialogContent
        closeOutside
        className="right-3 left-auto top-3 h-[min(720px,calc(100dvh-24px))] w-[min(440px,calc(100vw-24px))] max-w-none translate-x-0 translate-y-0 overflow-visible"
      >
        <div className="flex min-h-0 flex-1 flex-col pt-4">
          <div className="space-y-3 overflow-y-auto px-5 py-4">
            <div className="flex items-center gap-2">
              <span className="font-semibold tabular-nums">
                {request.request_code}
              </span>
              <StatusPill variant={statusVariant(request.status)}>
                {t(`status.${request.status}` as "status.pending")}
              </StatusPill>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(`types.${request.request_type}` as "types.leave")} ·{" "}
              {request.current_step_label ?? "—"}
            </p>
            <dl className="space-y-2 text-sm">
              {rows.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("detail.noTypedFields")}
                </p>
              ) : (
                rows.map((row) => (
                  <div key={row.label} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{row.label}</dt>
                    <dd className="max-w-[60%] break-words text-end font-medium">
                      {row.value}
                    </dd>
                  </div>
                ))
              )}
            </dl>
            {attachments.length > 0 ? (
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("detail.attachments")}
                </p>
                {attachments.map((a) => (
                  <p key={a.id} className="text-xs">
                    {a.file_name ?? a.storage_key}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
          <AppModalFooter
            title={t(`types.${request.request_type}` as "types.leave")}
            subtitle={request.request_code}
          >
            <DialogClose
              render={<Button type="button" variant="outline" className="h-9" />}
            >
              {t("detail.close")}
            </DialogClose>
          </AppModalFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
