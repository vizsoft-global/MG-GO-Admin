"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, PenLine } from "lucide-react";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { AppModalFooter } from "@/components/app/app-modal-footer";
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

  const rows = data?.rows ?? [];

  async function sign() {
    if (!active || !png) return;
    const result = await submit.mutateAsync({ request_id: active.request_id, pngBase64: png });
    if (!result.ok) {
      toast.error(result.error ?? t("signFailed"));
      return;
    }
    toast.success(t("signed"));
    setActive(null);
    setPng("");
  }

  async function reject() {
    if (!active) return;
    const result = await decline.mutateAsync({ request_id: active.request_id, reason });
    if (!result.ok) {
      toast.error(result.error ?? t("declineFailed"));
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
      <AppListCard className="p-4">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyBody")} />
        ) : (
          <AppDataTable
            columns={[
              { id: "code", label: t("colCode") },
              { id: "title", label: t("colTitle") },
              { id: "rider", label: t("colRider") },
              { id: "role", label: t("colRole") },
              { id: "open", label: "" },
            ]}
          >
            {rows.map((row) => (
              <AppDataTableRow key={row.signer_id}>
                <TableCell className="text-xs font-medium">{row.request_code}</TableCell>
                <TableCell className="text-xs">{row.title}</TableCell>
                <TableCell className="text-xs">
                  {row.driver_name ?? "—"}
                  {row.driver_code ? ` · ${row.driver_code}` : ""}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {row.role === "manager"
                    ? t("roleManager")
                    : row.role === "witness"
                      ? t("roleWitness")
                      : t("roleCountersigner")}
                </TableCell>
                <TableCell className="text-end">
                  <Button
                    type="button"
                    size="sm"
                    className="h-8"
                    onClick={() => {
                      setActive(row);
                      setPng("");
                      setReason("");
                    }}
                  >
                    <PenLine className="me-1.5 h-3.5 w-3.5" />
                    {t("open")}
                  </Button>
                </TableCell>
              </AppDataTableRow>
            ))}
          </AppDataTable>
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
                  ? esignDocumentHref(active.request_id, "document", "inline")
                  : undefined
              }
              className="h-[280px] w-full rounded-lg border border-border bg-card"
            />
            <div className="space-y-1">
              <Label>{t("draw")}</Label>
              <SignaturePad onChange={setPng} clearLabel={t("clear")} />
            </div>
            <div className="space-y-1">
              <Label>{t("declineReason")}</Label>
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
