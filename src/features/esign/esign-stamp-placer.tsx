"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, X, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { queryKeys } from "@/lib/query/query-keys";
import {
  loadEsignStampSheet,
  saveEsignFormSheet,
  saveEsignStampLayout,
} from "./esign-stamp-actions";
import {
  A4_HEIGHT_PT,
  A4_WIDTH_PT,
} from "./render/esign-document-layout";
import { fitEsignSinglePage } from "./render/esign-document-html";
import {
  addStampPiece,
  centeredDocumentScroll,
  clampPiece,
  completeStampLayout,
  defaultStampLayout,
  isExtraStampPiece,
  layoutAroundSignature,
  missingStampPieces,
  parseStampLayout,
  pieceFromPageRect,
  pieceToCss,
  resizeStampPiece,
  restoreStampPieces,
  RESIZE_CORNERS,
  stampLayoutKey,
  stampPieceLabelKey,
  stampPieceText,
  type ResizeCorner,
  type StampLayout,
  type StampPiece,
  type StampPieceId,
  type StampPieceLabels,
} from "./esign-stamp-layout";

export type EsignStampPlacerHandle = {
  flush: () => Promise<boolean>;
};

const A4_CSS_WIDTH = (A4_WIDTH_PT * 96) / 72;
const A4_CSS_HEIGHT = (A4_HEIGHT_PT * 96) / 72;
const PX_PER_PT = 96 / 72;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 1.25;

type Gesture = {
  id: StampPieceId;
  pointerId: number;
  originX: number;
  originY: number;
  piece: StampPiece;
  corner: ResizeCorner | null;
};

const FORM_EDIT_SELECTOR = ".sec, .l, .v, .h, .ln > span, .note, .text";

/**
 * iframe nodes come from another realm, so `node instanceof HTMLElement` is false for every
 * one of them. Duck-typing is the only check that holds across the document boundary.
 */
function isElement(node: unknown): node is HTMLElement {
  return (
    !!node &&
    typeof (node as { hasAttribute?: unknown }).hasAttribute === "function" &&
    typeof (node as { remove?: unknown }).remove === "function"
  );
}

function cornerBoxClass(corner: ResizeCorner): string {
  switch (corner) {
    case "nw":
      return "absolute -left-1 -top-1 z-10 h-2.5 w-2.5 cursor-nwse-resize border border-emerald-500 bg-white touch-none";
    case "ne":
      return "absolute -right-1 -top-1 z-10 h-2.5 w-2.5 cursor-nesw-resize border border-emerald-500 bg-white touch-none";
    case "sw":
      return "absolute -left-1 -bottom-1 z-10 h-2.5 w-2.5 cursor-nesw-resize border border-emerald-500 bg-white touch-none";
    case "se":
      return "absolute -right-1 -bottom-1 z-10 h-2.5 w-2.5 cursor-nwse-resize border border-emerald-500 bg-white touch-none";
    default: {
      const exhaustive: never = corner;
      return exhaustive;
    }
  }
}

function openedLayout(raw: unknown): StampLayout | null {
  const parsed = parseStampLayout(raw);
  return parsed ? completeStampLayout(parsed) : null;
}

type ReadyGate = { promise: Promise<void>; resolve: () => void };

export const EsignStampPlacer = forwardRef<
  EsignStampPlacerHandle,
  {
    requestId: string;
    signatureUrl: string;
    documentKind: unknown;
    signatureSlots: unknown;
    stampLayout: unknown;
    labels: StampPieceLabels;
  }
>(function EsignStampPlacer(
  { requestId, signatureUrl, documentKind, signatureSlots, stampLayout, labels },
  ref,
) {
  const t = useTranslations("pages.requests.esign.detail");
  const queryClient = useQueryClient();
  const saved = parseStampLayout(stampLayout);
  const [layout, setLayout] = useState<StampLayout | null>(() => openedLayout(stampLayout));
  const [html, setHtml] = useState<string | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [previewError, setPreviewError] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [formStatus, setFormStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [formReason, setFormReason] = useState("");
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const layoutRef = useRef<StampLayout | null>(openedLayout(stampLayout));
  const viewScaleRef = useRef(1);
  const fitScaleRef = useRef(1);
  const zoomRef = useRef(1);
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);
  const viewScale = fitScale * zoom;
  viewScaleRef.current = viewScale;
  fitScaleRef.current = fitScale;
  const gestureRef = useRef<Gesture | null>(null);
  const formDirtyRef = useRef(false);
  const saveFormRef = useRef<() => Promise<boolean>>(async () => false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainRef = useRef(Promise.resolve());
  const savedKeyRef = useRef<string | null>(saved ? stampLayoutKey(saved) : null);
  const flushRef = useRef<() => Promise<boolean>>(async () => false);
  const stampLayoutRef = useRef(stampLayout);
  const readyRef = useRef<ReadyGate | null>(null);
  if (!readyRef.current) {
    let resolve = () => {};
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    readyRef.current = { promise, resolve };
  }

  if (layout) layoutRef.current = layout;

  function replacePiece(id: StampPieceId, next: StampPiece) {
    setLayout((current) => {
      if (!current) return current;
      const pieces = current.pieces.map((piece) => (piece.id === id ? next : piece));
      const updated = { pieces };
      layoutRef.current = updated;
      return updated;
    });
  }

  function removePiece(id: StampPieceId) {
    setLayout((current) => {
      if (!current) return current;
      const removed = current.removed ?? [];
      const updated: StampLayout = {
        pieces: current.pieces.filter((piece) => piece.id !== id),
        removed: removed.includes(id) ? removed : [...removed, id],
      };
      layoutRef.current = updated;
      return updated;
    });
    scheduleSave();
  }

  function restorePieces() {
    setLayout((current) => {
      if (!current) return current;
      const updated = restoreStampPieces(current);
      layoutRef.current = updated;
      return updated;
    });
    scheduleSave();
  }

  function addPiece(id: StampPieceId) {
    setLayout((current) => {
      if (!current) return current;
      const updated = addStampPiece(current, id);
      layoutRef.current = updated;
      return updated;
    });
    setAdding(false);
    scheduleSave();
  }

  async function persist(): Promise<boolean> {
    const current = layoutRef.current;
    if (!current) return false;
    const key = stampLayoutKey(current);
    if (key === savedKeyRef.current) return true;
    setStatus("saving");
    setReason("");
    const result = await saveEsignStampLayout(requestId, current);
    if (!result.ok) {
      if (layoutRef.current && stampLayoutKey(layoutRef.current) === key) {
        setStatus("error");
        setReason(result.error);
      }
      return false;
    }
    if (layoutRef.current && stampLayoutKey(layoutRef.current) === key) {
      savedKeyRef.current = key;
      setStatus("saved");
    }
    void queryClient.invalidateQueries({
      queryKey: [...queryKeys.esign.detail(requestId), "document-links"],
    });
    return true;
  }

  function enqueue(): Promise<boolean> {
    const run = chainRef.current.then(() => persist(), () => persist());
    chainRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function scheduleSave() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void enqueue();
    }, 450);
  }

  flushRef.current = async () => {
    await readyRef.current?.promise;
    if (formDirtyRef.current) {
      const formOk = await saveFormRef.current();
      if (!formOk) return false;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!layoutRef.current) return false;
    let ok = await enqueue();
    if (!layoutRef.current || stampLayoutKey(layoutRef.current) !== savedKeyRef.current) {
      ok = await enqueue();
    }
    return ok && layoutRef.current != null && stampLayoutKey(layoutRef.current) === savedKeyRef.current;
  };

  useImperativeHandle(ref, () => ({
    flush: () => flushRef.current(),
  }));

  useEffect(() => {
    if (parseStampLayout(stampLayout)) readyRef.current?.resolve();
  }, [stampLayout]);

  const applyZoom = useCallback((nextZoom: number) => {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nextZoom));
    if (Math.abs(clamped - zoomRef.current) < 0.001) return;
    const stage = stageRef.current;
    const before = fitScaleRef.current * zoomRef.current;
    const after = fitScaleRef.current * clamped;
    if (stage && before > 0) {
      pendingScrollRef.current = centeredDocumentScroll({
        scrollLeft: stage.scrollLeft,
        scrollTop: stage.scrollTop,
        viewportWidth: stage.clientWidth,
        viewportHeight: stage.clientHeight,
        pageWidth: A4_CSS_WIDTH,
        pageHeight: A4_CSS_HEIGHT,
        before,
        after,
      });
    }
    zoomRef.current = clamped;
    viewScaleRef.current = after;
    setZoom(clamped);
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(() => {
      const bounds = stage.getBoundingClientRect();
      const scale = Math.min(
        Math.max(bounds.width - 8, 160) / A4_CSS_WIDTH,
        Math.max(bounds.height - 8, 220) / A4_CSS_HEIGHT,
      );
      fitScaleRef.current = scale;
      viewScaleRef.current = scale * zoomRef.current;
      setFitScale(scale);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      applyZoom(zoomRef.current * (event.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP));
    }
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [applyZoom]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const pending = pendingScrollRef.current;
    if (!stage || !pending) return;
    stage.scrollLeft = pending.left;
    stage.scrollTop = pending.top;
    pendingScrollRef.current = null;
  }, [zoom]);

  useEffect(() => {
    let cancelled = false;
    void loadEsignStampSheet(requestId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setPreviewError(true);
        readyRef.current?.resolve();
        return;
      }
      setHtml(result.html);
    });
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  function onSheetLoad() {
    const doc = frameRef.current?.contentDocument;
    if (!doc) {
      setPreviewError(true);
      readyRef.current?.resolve();
      return;
    }
    const style = doc.createElement("style");
    style.textContent =
      "@media screen{body{background:#fff !important;}.page{margin:0 !important;box-shadow:none !important;}}";
    doc.head.appendChild(style);
    fitEsignSinglePage(doc);
    const page = doc.querySelector(".page");
    const line = doc.querySelector('i[data-slot-role="employee"]');
    if (
      !parseStampLayout(stampLayoutRef.current) &&
      isElement(page) &&
      isElement(line)
    ) {
      const pageBox = page.getBoundingClientRect();
      const lineBox = line.getBoundingClientRect();
      if (pageBox.width > 0 && lineBox.width > 0) {
        const next = layoutAroundSignature(pieceFromPageRect(lineBox, pageBox));
        layoutRef.current = next;
        setLayout(next);
      }
    }
    if (!layoutRef.current) {
      const fallback = defaultStampLayout(documentKind, signatureSlots);
      layoutRef.current = fallback;
      setLayout(fallback);
    }
    setPreviewError(false);
    readyRef.current?.resolve();
  }

  function readSheetHtml(): string | null {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.documentElement) return null;
    const clone = doc.documentElement.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("[contenteditable]").forEach((node) => {
      node.removeAttribute("contenteditable");
    });
    clone.querySelectorAll("[data-form-edit]").forEach((node) => {
      node.removeAttribute("data-form-edit");
    });
    clone.querySelector("#stamp-fit-style")?.remove();
    clone.querySelector("#form-edit-style")?.remove();
    return `<!doctype html>${clone.outerHTML}`;
  }

  function applyFormEditing(on: boolean) {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    doc.getElementById("form-edit-style")?.remove();
    doc.querySelectorAll(FORM_EDIT_SELECTOR).forEach((node) => {
      if (!isElement(node)) return;
      if (on) {
        node.setAttribute("contenteditable", "true");
        node.setAttribute("data-form-edit", "1");
      } else {
        node.removeAttribute("contenteditable");
        node.removeAttribute("data-form-edit");
      }
    });
    if (!on || !doc.head) return;
    const style = doc.createElement("style");
    style.id = "form-edit-style";
    style.textContent = "[data-form-edit]{outline:1px dashed #059669;outline-offset:1px}";
    doc.head.appendChild(style);
  }

  async function saveForm(): Promise<boolean> {
    const current = layoutRef.current;
    const html = readSheetHtml();
    if (!current || !html) {
      setFormStatus("error");
      setFormReason("invalid_sheet");
      return false;
    }
    setFormStatus("saving");
    setFormReason("");
    const result = await saveEsignFormSheet(requestId, html, current);
    if (!result.ok) {
      setFormStatus("error");
      setFormReason(result.error);
      return false;
    }
    formDirtyRef.current = false;
    setFormDirty(false);
    setFormStatus("saved");
    savedKeyRef.current = stampLayoutKey(current);
    void queryClient.invalidateQueries({
      queryKey: [...queryKeys.esign.detail(requestId), "document-links"],
    });
    return true;
  }

  saveFormRef.current = saveForm;

  async function toggleEdit() {
    if (editing) {
      if (formDirtyRef.current) {
        const ok = await saveForm();
        if (!ok) return;
      }
      applyFormEditing(false);
      setEditing(false);
      return;
    }
    applyFormEditing(true);
    setEditing(true);
  }

  useEffect(() => {
    if (!editing) return;
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    const onInput = () => {
      formDirtyRef.current = true;
      setFormDirty(true);
    };
    const onEditableKeyDown = (event: Event) => {
      const key = (event as { key?: unknown }).key;
      if (key !== "Backspace" && key !== "Delete") return;
      const target = event.target;
      if (!isElement(target) || !target.hasAttribute("data-form-edit")) return;
      if ((target.textContent ?? "").trim() !== "") return;
      event.preventDefault();
      target.remove();
      formDirtyRef.current = true;
      setFormDirty(true);
    };
    doc.addEventListener("input", onInput);
    doc.addEventListener("keydown", onEditableKeyDown);
    return () => {
      doc.removeEventListener("input", onInput);
      doc.removeEventListener("keydown", onEditableKeyDown);
    };
  }, [editing, html]);

  function beginGesture(
    event: PointerEvent<HTMLButtonElement>,
    piece: StampPiece,
    corner: ResizeCorner | null,
  ) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = {
      id: piece.id,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      piece,
      corner,
    };
  }

  function onGestureMove(event: PointerEvent<HTMLButtonElement>) {
    const gesture = gestureRef.current;
    const scale = viewScaleRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || !scale) return;
    const dx = (event.clientX - gesture.originX) / scale / PX_PER_PT;
    const dyDown = (event.clientY - gesture.originY) / scale / PX_PER_PT;
    if (gesture.corner) {
      replacePiece(gesture.id, resizeStampPiece(gesture.piece, gesture.corner, dx, dyDown));
      return;
    }
    replacePiece(
      gesture.id,
      clampPiece({
        ...gesture.piece,
        xPt: gesture.piece.xPt + dx,
        yPt: gesture.piece.yPt - dyDown,
      }),
    );
  }

  function onGestureUp(event: PointerEvent<HTMLButtonElement>) {
    if (!gestureRef.current || gestureRef.current.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    scheduleSave();
  }

  function onResizeKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    piece: StampPiece,
    corner: ResizeCorner,
  ) {
    const step = event.shiftKey ? 5 : 1;
    let dx = 0;
    let dyDown = 0;
    if (event.key === "ArrowLeft") dx = -step;
    else if (event.key === "ArrowRight") dx = step;
    else if (event.key === "ArrowUp") dyDown = -step;
    else if (event.key === "ArrowDown") dyDown = step;
    else return;
    event.preventDefault();
    event.stopPropagation();
    replacePiece(piece.id, resizeStampPiece(piece, corner, dx, dyDown));
    scheduleSave();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, piece: StampPiece) {
    const step = event.shiftKey ? 5 : 1;
    let dx = 0;
    let dy = 0;
    if (event.key === "ArrowLeft") dx = -step;
    else if (event.key === "ArrowRight") dx = step;
    else if (event.key === "ArrowUp") dy = step;
    else if (event.key === "ArrowDown") dy = -step;
    else return;
    event.preventDefault();
    replacePiece(piece.id, clampPiece({ ...piece, xPt: piece.xPt + dx, yPt: piece.yPt + dy }));
    scheduleSave();
  }

  const missingPieces = layout ? missingStampPieces(layout) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="relative min-h-0 flex-1">
        <div className="pointer-events-none absolute end-2 top-2 z-10">
          <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm">
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              aria-label={t("zoomOut")}
              disabled={zoom <= ZOOM_MIN + 0.001}
              onClick={() => applyZoom(zoomRef.current / ZOOM_STEP)}
            >
              <ZoomOut />
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9 min-w-14 px-2 text-xs tabular-nums"
              aria-label={t("zoomFit")}
              onClick={() => applyZoom(1)}
            >
              {Math.round(zoom * 100)}%
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              aria-label={t("zoomIn")}
              disabled={zoom >= ZOOM_MAX - 0.001}
              onClick={() => applyZoom(zoomRef.current * ZOOM_STEP)}
            >
              <ZoomIn />
            </Button>
            {!editing && missingPieces.length > 0 ? (
              <Popover open={adding} onOpenChange={setAdding}>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 gap-1 px-2 text-xs"
                    />
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("addPiece")}
                </PopoverTrigger>
                <PopoverContent align="end" className="w-44 origin-(--transform-origin) p-1">
                  {missingPieces.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className="flex w-full items-center rounded-md px-2 py-1.5 text-start text-xs text-foreground transition-colors hover:bg-muted"
                      onClick={() => addPiece(id)}
                    >
                      {t(stampPieceLabelKey(id))}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            ) : null}
            {layout?.removed?.length ? (
              <Button
                type="button"
                variant="outline"
                className="h-9 px-2 text-xs"
                onClick={restorePieces}
              >
                {t("restorePieces", { count: layout.removed.length })}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              aria-pressed={editing}
              disabled={!html}
              className={
                editing
                  ? "h-9 border-emerald-500 bg-emerald-100 px-2 text-xs font-semibold text-emerald-900"
                  : "h-9 px-2 text-xs"
              }
              onClick={() => void toggleEdit()}
            >
              {t("editForm")}
            </Button>
            {formDirty ? (
              <Button
                type="button"
                className="h-9 px-2 text-xs"
                disabled={formStatus === "saving"}
                onClick={() => void saveForm()}
              >
                {t("saveForm")}
              </Button>
            ) : null}
          </div>
        </div>
        <div
          ref={stageRef}
          className="absolute inset-0 overflow-auto rounded-lg border border-border bg-muted/40"
        >
        {previewError ? (
          <p className="p-4 text-xs text-destructive">{t("placePreviewFailed")}</p>
        ) : (
          <div className="inline-flex min-h-full min-w-full items-center justify-center">
            <div
              className="relative shrink-0"
              style={{
                width: A4_CSS_WIDTH * viewScale,
                height: A4_CSS_HEIGHT * viewScale,
              }}
            >
          <div
            className="absolute top-0 left-0"
            style={{
              width: A4_CSS_WIDTH,
              height: A4_CSS_HEIGHT,
              transform: `scale(${viewScale})`,
              transformOrigin: "top left",
            }}
          >
            {html ? (
              <iframe
                ref={frameRef}
                title={labels.code}
                srcDoc={html}
                onLoad={onSheetLoad}
                className={`${editing ? "pointer-events-auto" : "pointer-events-none"} absolute top-0 left-0 border-0 bg-white`}
                style={{ width: A4_CSS_WIDTH, height: A4_CSS_HEIGHT }}
              />
            ) : null}
            {layout
              ? layout.pieces.map((piece) => {
                  const box = pieceToCss(piece, PX_PER_PT, A4_HEIGHT_PT);
                  const text = stampPieceText(piece.id, labels);
                  const label = t(stampPieceLabelKey(piece.id));
                  return (
                    <div
                      key={piece.id}
                      className={editing ? "pointer-events-none absolute" : "absolute"}
                      style={{
                        left: box.left,
                        top: box.top,
                        width: box.width,
                        height: box.height,
                      }}
                    >
                      <button
                        type="button"
                        aria-label={label}
                        className="absolute inset-0 cursor-grab border border-emerald-500 bg-white/80 text-left text-[10px] leading-tight text-emerald-950 select-none touch-none active:cursor-grabbing"
                        onPointerDown={(event) => beginGesture(event, piece, null)}
                        onPointerMove={onGestureMove}
                        onPointerUp={onGestureUp}
                        onKeyDown={(event) => onKeyDown(event, piece)}
                      >
                        <span className="pointer-events-none absolute -top-4 left-0 rounded bg-emerald-100 px-1 font-medium text-emerald-900">
                          {label}
                        </span>
                        {piece.id === "signature" ? (
                          <img
                            src={signatureUrl}
                            alt=""
                            draggable={false}
                            className="pointer-events-none h-full w-full object-contain"
                          />
                        ) : (
                          <span className="pointer-events-none block truncate px-1">{text}</span>
                        )}
                      </button>
                      {!editing && isExtraStampPiece(piece.id) ? (
                        <button
                          type="button"
                          aria-label={t("removePiece", { piece: label })}
                          title={t("removePiece", { piece: label })}
                          className="absolute -top-4 right-0 z-20 flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-destructive/60 bg-card text-destructive transition-colors hover:bg-destructive/10"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            removePiece(piece.id);
                          }}
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      ) : null}
                      {RESIZE_CORNERS.map((corner) => (
                        <button
                          key={corner}
                          type="button"
                          aria-label={t("resizePiece", { piece: label })}
                          className={cornerBoxClass(corner)}
                          onPointerDown={(event) => beginGesture(event, piece, corner)}
                          onPointerMove={onGestureMove}
                          onPointerUp={onGestureUp}
                          onKeyDown={(event) => onResizeKeyDown(event, piece, corner)}
                        />
                      ))}
                    </div>
                  );
                })
              : null}
          </div>
            </div>
          </div>
        )}
        {!html && !previewError ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">{t("placeHint")}</p>
      {editing ? <p className="text-[10px] text-emerald-800">{t("formDeleteHint")}</p> : null}
      {formStatus === "saving" ? (
        <p className="text-[10px] text-muted-foreground">{t("formSaving")}</p>
      ) : null}
      {formStatus === "saved" ? (
        <p className="text-[10px] text-emerald-800">{t("formSaved")}</p>
      ) : null}
      {formStatus === "error" ? (
        <p className="text-[10px] text-destructive">{t("formSaveFailed", { reason: formReason })}</p>
      ) : null}
      {status === "saving" ? (
        <p className="text-[10px] text-muted-foreground">{t("placeSaving")}</p>
      ) : null}
      {status === "saved" ? (
        <p className="text-[10px] text-emerald-800">{t("placeSaved")}</p>
      ) : null}
      {status === "error" ? (
        <p className="text-[10px] text-destructive">{t("placeSaveFailed", { reason })}</p>
      ) : null}
    </div>
  );
});
