export type ZoneMapDrawModeLite = "polygon" | "circle";

/** Geoman options so users can finish polygons with dbl-click or Enter */
export function geomanDrawOptions(drawMode: ZoneMapDrawModeLite) {
  const shape = drawMode === "circle" ? "Circle" : "Polygon";
  if (shape === "Polygon") {
    return {
      shape: "Polygon" as const,
      options: {
        finishOn: "dblclick" as const,
        finishOnEnter: true,
        continueDrawing: false,
      },
    };
  }
  return {
    shape: "Circle" as const,
    options: { continueDrawing: false },
  };
}
