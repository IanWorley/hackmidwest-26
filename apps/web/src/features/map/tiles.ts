/** Keyless public tile services. Leaflet loads them as images, so they never pass through the API client. */
interface TileSource {
  readonly url: string;
  readonly attribution: string;
}

export const BASE_TILES: TileSource = {
  url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
  attribution: "USGS The National Map",
};

export const RADAR_TILES: TileSource = {
  url: "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png",
  attribution: "NEXRAD radar: Iowa Environmental Mesonet",
};
