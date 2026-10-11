const MS_PER_MINUTE = 60_000;
/** IEM rebuilds its NEXRAD composite every five minutes and serves each tile with a matching max-age. */
const RADAR_FRAME_MINUTES = 5;

/** Keyless public tile services. Leaflet loads them as images, so they never pass through the API client. */
interface TileSource {
  readonly url: string;
  readonly attribution: string;
}

export const RADAR_FRAME_MS = RADAR_FRAME_MINUTES * MS_PER_MINUTE;

export const BASE_TILES: TileSource = {
  url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
  attribution:
    "Map services and data available from U.S. Geological Survey, National Geospatial Program.",
};

export const RADAR_TILES: TileSource = {
  url: "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png",
  attribution: "Radar: Iowa Environmental Mesonet, Iowa State University.",
};

/**
 * The radar tile URL for the composite frame current at `nowMs`. A new frame changes the URL, which makes Leaflet
 * reload every radar tile, so a page left open keeps showing current precipitation.
 */
export function radarTileUrl(nowMs: number): string {
  return `${RADAR_TILES.url}?frame=${Math.floor(nowMs / RADAR_FRAME_MS)}`;
}

/** Open-Meteo's license requires crediting the modeled AQI wherever it is shown. */
export const AQI_ATTRIBUTION =
  "Air quality: modeled US AQI from Open-Meteo (CAMS), CC BY 4.0";
