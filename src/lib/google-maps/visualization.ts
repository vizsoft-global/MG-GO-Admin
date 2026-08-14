type HeatmapLayerCtor = new (opts: Record<string, unknown>) => unknown;

type VisualizationHost = {
  maps: {
    visualization?: { HeatmapLayer: HeatmapLayerCtor };
    importLibrary?: (id: string) => Promise<unknown>;
  };
};

function pickHeatmapLayer(imported: unknown): HeatmapLayerCtor | undefined {
  if (!imported || typeof imported !== "object") return undefined;
  const rec = imported as Record<string, unknown>;
  if (typeof rec.HeatmapLayer === "function") {
    return rec.HeatmapLayer as HeatmapLayerCtor;
  }
  const nested = rec.visualization;
  if (nested && typeof nested === "object") {
    const ctor = (nested as Record<string, unknown>).HeatmapLayer;
    if (typeof ctor === "function") return ctor as HeatmapLayerCtor;
  }
  return undefined;
}

/** `loading=async` often leaves `maps.visualization` empty until we copy the import. */
export function attachVisualizationNamespace(
  api: VisualizationHost,
  imported: unknown,
): boolean {
  const HeatmapLayer = pickHeatmapLayer(imported) ?? api.maps.visualization?.HeatmapLayer;
  if (!HeatmapLayer) return false;
  api.maps.visualization = { HeatmapLayer };
  return true;
}

export async function ensureVisualizationLibrary(api: VisualizationHost): Promise<boolean> {
  if (api.maps.visualization?.HeatmapLayer) return true;
  try {
    const imported = await api.maps.importLibrary?.("visualization");
    return attachVisualizationNamespace(api, imported);
  } catch {
    return false;
  }
}
