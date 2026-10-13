export const EDGE_PX = 28;
export const EDGE_SCROLL_MIN = 4;
export const EDGE_SCROLL_MAX = 28;

export type EdgeBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type GridPointerLayout = {
  containerLeft: number;
  containerTop: number;
  scrollLeft: number;
  scrollTop: number;
  headerHeight: number;
  originX: number;
  rowHeight: number;
  colWidth: number;
  colStride?: number;
  rowCount: number;
  colCount: number;
};

export type SampleCellLayout = {
  containerLeft: number;
  containerTop: number;
  scrollLeft: number;
  scrollTop: number;
  headerHeight: number;
  cellLeft: number;
  cellWidth: number;
  cellHeight: number;
  cellCol: number;
  rowCount: number;
  colCount: number;
  colStride?: number;
};

export function edgeScrollDelta(distanceToEdge: number, maxDelta = EDGE_SCROLL_MAX): number {
  if (!Number.isFinite(distanceToEdge) || distanceToEdge >= EDGE_PX) return 0;
  const ceiling = Math.max(EDGE_SCROLL_MIN, maxDelta);
  const t = 1 - Math.max(0, distanceToEdge) / EDGE_PX;
  const raw = EDGE_SCROLL_MIN + t * (ceiling - EDGE_SCROLL_MIN);
  return Math.min(ceiling, Math.max(EDGE_SCROLL_MIN, Math.round(raw)));
}

export function maybeEdgeScroll(
  container: EdgeBox,
  clientX: number,
  clientY: number,
  edgePx = EDGE_PX,
): { dx: number; dy: number } {
  const distLeft = clientX - container.left;
  const distRight = container.right - clientX;
  const distTop = clientY - container.top;
  const distBottom = container.bottom - clientY;

  let dx = 0;
  let dy = 0;
  if (distLeft <= edgePx) dx = -edgeScrollDelta(distLeft);
  else if (distRight <= edgePx) dx = edgeScrollDelta(distRight);
  if (distTop <= edgePx) dy = -edgeScrollDelta(distTop);
  else if (distBottom <= edgePx) dy = edgeScrollDelta(distBottom);
  return { dx, dy };
}

export function mapPointerToCell(
  clientX: number,
  clientY: number,
  layout: GridPointerLayout,
): { row: number; col: number } | null {
  if (layout.rowCount <= 0 || layout.colCount <= 0) return null;
  if (layout.rowHeight <= 0) return null;
  const stride = layout.colStride ?? layout.colWidth;
  if (stride <= 0) return null;
  const y = clientY - layout.containerTop + layout.scrollTop - layout.headerHeight;
  const x = clientX - layout.containerLeft + layout.scrollLeft - layout.originX;
  const row = Math.min(layout.rowCount - 1, Math.max(0, Math.floor(y / layout.rowHeight)));
  const col = Math.min(layout.colCount - 1, Math.max(0, Math.floor(x / stride)));
  return { row, col };
}

export function layoutFromSampleCell(sample: SampleCellLayout): {
  headerHeight: number;
  originX: number;
  rowHeight: number;
  colWidth: number;
  colStride: number;
  rowCount: number;
  colCount: number;
} {
  const stride = sample.colStride ?? sample.cellWidth;
  return {
    headerHeight: sample.headerHeight,
    originX: sample.cellLeft - sample.containerLeft + sample.scrollLeft - sample.cellCol * stride,
    rowHeight: sample.cellHeight,
    colWidth: sample.cellWidth,
    colStride: stride,
    rowCount: sample.rowCount,
    colCount: sample.colCount,
  };
}

export type GridEdgeScrollLayout = ReturnType<typeof layoutFromSampleCell>;

export function startGridEdgeScroll(options: {
  getContainer: () => HTMLElement | null;
  getLayout: () => GridEdgeScrollLayout | null;
  onHover: (row: number, col: number) => void;
  onEnd: () => void;
  clientX: number;
  clientY: number;
  edgePx?: number;
}): () => void {
  let active = true;
  let raf = 0;
  let x = options.clientX;
  let y = options.clientY;
  const edgePx = options.edgePx ?? EDGE_PX;

  const hover = (clientX: number, clientY: number) => {
    const el = options.getContainer();
    const layout = options.getLayout();
    if (!el || !layout) return;
    const box = el.getBoundingClientRect();
    const mapped = mapPointerToCell(clientX, clientY, {
      containerLeft: box.left,
      containerTop: box.top,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
      headerHeight: layout.headerHeight,
      originX: layout.originX,
      rowHeight: layout.rowHeight,
      colWidth: layout.colWidth,
      colStride: layout.colStride,
      rowCount: layout.rowCount,
      colCount: layout.colCount,
    });
    if (mapped) options.onHover(mapped.row, mapped.col);
  };

  const frame = () => {
    raf = 0;
    if (!active) return;
    const el = options.getContainer();
    if (!el) return;
    const { dx, dy } = maybeEdgeScroll(el.getBoundingClientRect(), x, y, edgePx);
    if (!dx && !dy) return;
    el.scrollLeft += dx;
    el.scrollTop += dy;
    hover(x, y);
    raf = requestAnimationFrame(frame);
  };

  const onMove = (event: PointerEvent) => {
    if (!active) return;
    x = event.clientX;
    y = event.clientY;
    hover(x, y);
    if (!raf) raf = requestAnimationFrame(frame);
  };

  const finish = () => {
    if (!active) return;
    active = false;
    detach();
    options.onEnd();
  };

  const detach = () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", finish);
    document.removeEventListener("pointercancel", finish);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", finish);
  document.addEventListener("pointercancel", finish);
  hover(x, y);
  raf = requestAnimationFrame(frame);

  return () => {
    if (!active) return;
    active = false;
    detach();
  };
}
