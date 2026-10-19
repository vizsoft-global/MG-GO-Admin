"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { A4_HEIGHT_PT, A4_WIDTH_PT } from "./render/esign-document-layout";
import { centeredDocumentScroll } from "./esign-stamp-layout";

/** A4 at 96 CSS dpi — the coordinate system every sheet iframe uses. */
export const A4_CSS_WIDTH = (A4_WIDTH_PT * 96) / 72;
export const A4_CSS_HEIGHT = (A4_HEIGHT_PT * 96) / 72;

export const A4_ZOOM_MIN = 0.6;
export const A4_ZOOM_MAX = 3;
export const A4_ZOOM_STEP = 1.25;

type Args = {
  stageRef: RefObject<HTMLDivElement | null>;
  /** Space kept around the page so the paper edge is visible. */
  padding?: number;
  /** Never fit the page into a box narrower/shorter than this. */
  minViewportWidth?: number;
  minViewportHeight?: number;
  /** Number of A4 pages the iframe currently shows. */
  pageCount?: number;
  initialZoom?: number;
};

/**
 * One zoom model for every A4 surface: contain-fit, cursor-centred zoom and a
 * scrollable stage when the sheet is larger than the viewport.
 *
 * The stamp placer and the read-only document previews otherwise drift apart:
 * one used cover (clipping the footer), the other had no zoom at all.
 */
export function useA4Zoom({
  stageRef,
  padding = 8,
  minViewportWidth = 160,
  minViewportHeight = 220,
  pageCount = 1,
  initialZoom = 1,
}: Args) {
  const [fitScale, setFitScale] = useState(1);
  const [zoom, setZoomState] = useState(initialZoom);
  const fitScaleRef = useRef(1);
  const zoomRef = useRef(initialZoom);
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);

  const pageWidth = A4_CSS_WIDTH;
  const pageHeight = A4_CSS_HEIGHT * Math.max(1, pageCount);
  const viewScale = fitScale * zoom;
  const viewScaleRef = useRef(viewScale);
  viewScaleRef.current = viewScale;

  const applyZoom = useCallback(
    (nextZoom: number) => {
      const clamped = Math.min(A4_ZOOM_MAX, Math.max(A4_ZOOM_MIN, nextZoom));
      const stage = stageRef.current;
      const before = fitScaleRef.current * zoomRef.current;
      const after = fitScaleRef.current * clamped;
      if (stage && before > 0) {
        pendingScrollRef.current = centeredDocumentScroll({
          scrollLeft: stage.scrollLeft,
          scrollTop: stage.scrollTop,
          viewportWidth: stage.clientWidth,
          viewportHeight: stage.clientHeight,
          pageWidth,
          pageHeight,
          before,
          after,
        });
      }
      zoomRef.current = clamped;
      setZoomState(clamped);
    },
    [pageHeight, pageWidth, stageRef],
  );

  const zoomIn = useCallback(
    () => applyZoom(zoomRef.current * A4_ZOOM_STEP),
    [applyZoom],
  );
  const zoomOut = useCallback(
    () => applyZoom(zoomRef.current / A4_ZOOM_STEP),
    [applyZoom],
  );
  const resetZoom = useCallback(() => applyZoom(1), [applyZoom]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(() => {
      const bounds = stage.getBoundingClientRect();
      const scale = Math.min(
        Math.max(bounds.width - padding * 2, minViewportWidth, 1) / pageWidth,
        Math.max(bounds.height - padding * 2, minViewportHeight, 1) / pageHeight,
      );
      fitScaleRef.current = scale;
      setFitScale(scale);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [minViewportHeight, minViewportWidth, padding, pageHeight, pageWidth, stageRef]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      applyZoom(
        zoomRef.current * (event.deltaY > 0 ? 1 / A4_ZOOM_STEP : A4_ZOOM_STEP),
      );
    }
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [applyZoom, stageRef]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const pending = pendingScrollRef.current;
    if (!stage || !pending) return;
    stage.scrollLeft = pending.left;
    stage.scrollTop = pending.top;
    pendingScrollRef.current = null;
  }, [fitScale, stageRef, zoom]);

  return {
    applyZoom,
    zoom,
    zoomRef,
    fitScale,
    viewScale,
    viewScaleRef,
    zoomIn,
    zoomOut,
    resetZoom,
    canZoomIn: zoom < A4_ZOOM_MAX - 0.001,
    canZoomOut: zoom > A4_ZOOM_MIN + 0.001,
  };
}
