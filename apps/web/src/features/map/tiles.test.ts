import { expect, it } from "vitest";
import { RADAR_FRAME_MS, radarTileUrl } from "./tiles";

/** Any whole frame number; the boundary is what matters. */
const FRAME_INDEX = 1000;

it("keeps one radar URL within a composite frame and changes it for the next frame", () => {
  const frameStart = FRAME_INDEX * RADAR_FRAME_MS;
  expect([
    radarTileUrl(frameStart + RADAR_FRAME_MS - 1) === radarTileUrl(frameStart),
    radarTileUrl(frameStart + RADAR_FRAME_MS) === radarTileUrl(frameStart),
  ]).toEqual([true, false]);
});
