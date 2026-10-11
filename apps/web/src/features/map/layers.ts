import { useSearch } from "@tanstack/react-router";

const MAP_LAYERS = ["alerts", "aqi", "radar"] as const;

type MapLayer = (typeof MAP_LAYERS)[number];

const MAP_LAYER_LABELS: Record<MapLayer, string> = {
  alerts: "Alerts",
  aqi: "Air quality",
  radar: "Radar",
};

const LAYER_SEPARATOR = ",";
const MAP_LAYER_NAMES: ReadonlySet<string> = new Set(MAP_LAYERS);

function isMapLayer(name: string): name is MapLayer {
  return MAP_LAYER_NAMES.has(name);
}

/** Lenient, so a hand-edited or stale URL still opens: unknown names drop out, and order and duplicates do not matter. */
function parseLayers(raw: unknown): MapLayer[] {
  if (typeof raw !== "string") {
    return [];
  }
  const requested = new Set(raw.split(LAYER_SEPARATOR).filter(isMapLayer));
  return MAP_LAYERS.filter((layer) => requested.has(layer));
}

/** The search value for a set of layers; undefined drops the parameter when none are on. */
function encodeLayers(layers: readonly string[]): string | undefined {
  const canonical = parseLayers(layers.join(LAYER_SEPARATOR));
  if (canonical.length === 0) {
    return undefined;
  }
  return canonical.join(LAYER_SEPARATOR);
}

/** The `layers` search value with one layer switched off. */
function withoutLayer(
  raw: string | undefined,
  layer: MapLayer,
): string | undefined {
  return encodeLayers(parseLayers(raw).filter((name) => name !== layer));
}

/** The router serializes what this returns, so `?layers=` stays a readable comma-separated string, rewritten to canonical form. */
function validateLayersSearch(search: Record<string, unknown>): {
  layers?: string | undefined;
} {
  return { layers: encodeLayers(parseLayers(search.layers)) };
}

/** The layers switched on in the current `/conditions` URL. */
function useMapLayers(): MapLayer[] {
  return useSearch({
    from: "/conditions",
    select: ({ layers }): MapLayer[] => parseLayers(layers),
  });
}

export type { MapLayer };
export {
  encodeLayers,
  MAP_LAYER_LABELS,
  MAP_LAYERS,
  parseLayers,
  useMapLayers,
  validateLayersSearch,
  withoutLayer,
};
