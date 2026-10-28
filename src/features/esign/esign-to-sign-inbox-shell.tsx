"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CircleCheck, CircleX, Loader2, PenLine } from "lucide-react";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { groupRows } from "@/components/app/app-list-controls";
import {
  EmptyCell,
  TableGridCards,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { ToggleChip } from "@/components/app/toggle-chip";
import { AppDataTable, AppDataTableRow, TableCell } from "@/components/app/app-data-table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { esignDocumentHref } from "./esign-storage-key";
import type { EsignMySignatureRow } from "./types";
import { useDeclineMyEsignSignature, useMyEsignSignatures, useSubmitMyEsignSignature } from "./use-esign";

function SignaturePad({
  onChange,
  clearLabel,
}: {
  onChange: (dataUrl: string) => void;
  clearLabel: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const p = point(event);
    if (!canvas || !ctx || !p) return;
    drawing.current = true;
    canvas.setPointerCapture(event.pointerId);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    const p = point(event);
    if (!ctx || !p) return;
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function end() {
    drawing.current = false;
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL("image/png"));
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange("");
  }

  return (
    <div className="space-y-1">
      <canvas
        ref={canvasRef}
        width={640}
        height={160}
        className="h-28 w-full cursor-crosshair rounded-lg border border-border bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <Button type="button" variant="outline" className="h-8 text-xs" onClick={clear}>
        {clearLabel}
      </Button>
    </div>
  );
}

export function EsignToSignInboxShell() {
  const t = useTranslations("pages.requests.esign.toSign");
  const tHub = useTranslations("pages.requests.esign.hub");
  const { data, isLoading } = useMyEsignSignatures(true);
  const submit = useSubmitMyEsignSignature();
  const decline = useDeclineMyEsignSignature();
  const [active, setActive] = useState<EsignMySignatureRow | null>(null);
  const [png, setPng] = useState("");
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(null);

  const rows = useMemo(
    () => (data?.rows ?? []).filter((row) => row.signer_status === "pending"),
    [data?.rows],
  );
  const signColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "code", label: t("colCode"), locked: true },
      { id: "title", label: t("colTitle"), locked: true },
      { id: "rider", label: t("colRider") },
      { id: "role", label: t("colRole"), categorical: true },
      { id: "open", label: t("open"), locked: true },
    ],
    [t],
  );
  const tablePrefs = useTablePrefs("esign.toSign", signColumns);
  const shownColumns = tablePrefs.orderedColumns.filter((column) => tablePrefs.isVisible(column.id));
  const filteredRows = useMemo(() => {
    const query = tablePrefs.appliedQuery.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      [row.request_code, row.title, row.driver_name, row.driver_code].join(" ").toLowerCase().includes(query),
    );
  }, [rows, tablePrefs.appliedQuery]);
  const grouped = useMemo(
    () =>
      groupRows(
        filteredRows,
        tablePrefs.groupBy,
        {
          role: (row) =>
            row.role === "manager"
              ? t("roleManager")
              : row.role === "witness"
                ? t("roleWitness")
                : t("roleCountersigner"),
        },
        {},
        "—",
      ),
    [filteredRows, t, tablePrefs.groupBy],
  );

  function failureMessage(error: string | undefined, fallback: string) {
    if (error === "already_signed") return t("alreadySigned");
    if (error === "already_declined") return t("alreadyDeclined");
    if (error === "not_assigned") return t("notAssigned");
    if (error === "not_ready") return t("notReady");
    if (error === "reason_required") return t("reasonRequired");
    return fallback;
  }

  async function sign() {
    if (!active || !png) return;
    if (decision === "rejected" && !reason.trim()) {
      toast.error(t("reasonRequired"));
      return;
    }
    const result = await submit.mutateAsync({
      request_id: active.request_id,
      pngBase64: png,
      decision: decision ?? undefined,
      reason: decision === "rejected" ? reason : undefined,
    });
    if (!result.ok) {
      toast.error(failureMessage(result.error, t("signFailed")));
      return;
    }
    toast.success(t("signed"));
    setActive(null);
    setPng("");
    setDecision(null);
  }

  async function reject() {
    if (!active) return;
    const result = await decline.mutateAsync({ request_id: active.request_id, reason });
    if (!result.ok) {
      toast.error(failureMessage(result.error, t("declineFailed")));
      if (result.error === "already_signed" || result.error === "already_declined") {
        setActive(null);
        setReason("");
      }
      return;
    }
    toast.success(t("declined"));
    setActive(null);
    setReason("");
  }

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: tHub("requests"), href: "/employeedesk" },
          { label: tHub("title"), href: "/employeedesk/esign" },
          { label: t("title") },
        ]}
      />
      <AppListCard className="p-0">
        <TableToolbar
          prefs={tablePrefs}
          entity={t("title")}
          columns={signColumns}
          rowKind="dynamic"
          entityList
          filteredCount={filteredRows.length}
          totalCount={rows.length}
        />
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filteredRows.length === 0 ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyBody")} />
        ) : (
          tablePrefs.view === "grid" ? (
            <TableGridCards
              rows={filteredRows.map((row) => ({
                id: row.signer_id,
                name: row.title,
                fields: [
                  { label: t("colCode"), value: row.request_code },
                  { label: t("colRider"), value: row.driver_name ?? "—" },
                ],
                onOpen: () => {
                  setActive(row);
                  setPng("");
                  setReason("");
                  setDecision(null);
                },
              }))}
            />
          ) : (
          <AppDataTable
            columns={shownColumns.map((column) => ({
              id: column.id,
              label: column.id === "open" ? "" : column.label,
              className: column.id === "open" ? "text-end" : undefined,
            }))}
          >
            {grouped.flatMap((group) => [
              ...(tablePrefs.groupBy !== "none"
                ? [
                    <AppDataTableRow key={`g-${group.key}`} className="hover:bg-transparent">
                      <TableCell colSpan={shownColumns.length} className="text-xs font-semibold">
                        {group.label} · {group.rows.length}
                      </TableCell>
                    </AppDataTableRow>,
                  ]
                : []),
              ...group.rows.map((row) => {
                const roleLabel =
                  row.role === "manager"
                    ? t("roleManager")
                    : row.role === "witness"
                      ? t("roleWitness")
                      : t("roleCountersigner");
                const cells: Record<string, ReactNode> = {
                  code: <span className="text-xs font-medium">{row.request_code}</span>,
                  title: <TableNameCell name={row.title} />,
                  rider: row.driver_name ? (
                    <span className="text-xs">
                      {row.driver_name}
                      {row.driver_code ? ` · ${row.driver_code}` : ""}
                    </span>
                  ) : (
                    <EmptyCell />
                  ),
                  role: roleLabel,
                  open: (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8"
                      onClick={() => {
                        setActive(row);
                        setPng("");
                        setReason("");
                        setDecision(null);
                      }}
                    >
                      <PenLine className="me-1.5 h-3.5 w-3.5" />
                      {t("open")}
                    </Button>
                  ),
                };
                return (
              <AppDataTableRow key={row.signer_id}>
                {shownColumns.map((column) => (
                  <TableCell key={column.id} className={column.id === "open" ? "text-end" : undefined}>
                    {cells[column.id] ?? <EmptyCell />}
                  </TableCell>
                ))}
              </AppDataTableRow>
                );
              }),
            ])}
          </AppDataTable>
          )
        )}
      </AppListCard>

      <Dialog open={Boolean(active)} onOpenChange={(open) => !open && setActive(null)}>
        <DialogContent
          className="w-[min(1200px,96vw)] overflow-visible pt-4"
          showCloseButton
          closeOutside
        >
          <div className="space-y-3 px-5 py-4">
            <iframe
              title={active?.title ?? ""}
              src={
                active
                  ? esignDocumentHref(active.request_id, "signed", "inline")
                  : undefined
              }
              className="h-[280px] w-full rounded-lg border border-border bg-card"
            />
            <div className="space-y-1">
              <Label>{t("decision")}</Label>
              <div className="flex flex-wrap gap-2">
                <ToggleChip
                  size="sm"
                  className="h-9"
                  icon={CircleCheck}
                  selected={decision === "approved"}
                  onClick={() =>
                    setDecision((current) => (current === "approved" ? null : "approved"))
                  }
                >
                  {t("approved")}
                </ToggleChip>
                <ToggleChip
                  size="sm"
                  className="h-9"
                  icon={CircleX}
                  selected={decision === "rejected"}
                  onClick={() =>
                    setDecision((current) => (current === "rejected" ? null : "rejected"))
                  }
                >
                  {t("rejected")}
                </ToggleChip>
              </div>
              <p className="text-[10px] text-muted-foreground">{t("decisionHint")}</p>
            </div>
            <div className="space-y-1">
              <Label>{t("draw")}</Label>
              <SignaturePad onChange={setPng} clearLabel={t("clear")} />
            </div>
            <div className="space-y-1">
              <Label>
                {decision === "rejected" ? t("rejectReason") : t("declineReason")}
                {decision === "rejected" ? <span className="text-destructive"> *</span> : null}
              </Label>
              <Input
                className="h-9"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
          </div>
          <AppModalFooter title={active?.request_code ?? t("title")} subtitle={active?.title ?? ""}>
            <Button
              type="button"
              variant="outline"
              className="h-9 text-destructive hover:bg-destructive/10"
              disabled={decline.isPending}
              onClick={() => void reject()}
            >
              {t("decline")}
            </Button>
            <Button
              type="button"
              className="h-9"
              disabled={!png || submit.isPending}
              onClick={() => void sign()}
            >
              {submit.isPending ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {t("sign")}
            </Button>
          </AppModalFooter>
        </DialogContent>
      </Dialog>
    </AppPage>
  );
}
