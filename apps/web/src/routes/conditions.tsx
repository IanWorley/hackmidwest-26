import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { type JSX, lazy, Suspense, useCallback, useState } from "react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { LayerToggles } from "@/features/map/layer-toggles";
import {
  MAP_LAYERS,
  useMapLayers,
  validateLayersSearch,
} from "@/features/map/layers";
import { loadMap } from "@/features/map/load-map";
import { PostureLegend } from "@/features/map/posture-legend";
import { UnmappedAlerts } from "@/features/map/unmapped-alerts";
import { pageTitle } from "@/lib/page-title";
import { useRefreshEvery } from "@/lib/use-refresh-every";

const PAGE_HEADING = "Conditions";
const PAGE_TITLE = pageTitle(PAGE_HEADING);
const LOADING_TEXT = "Loading conditions...";
const MAP_LOADING_TEXT = "Loading map...";
const LOAD_ERROR_TEXT = "Conditions could not be loaded.";
const LIVE_UNAVAILABLE_TEXT =
  "Live alerts and air quality are unavailable. Facility standings are current.";
/** Matches the API's one-minute live-conditions cache, so an open page picks up new alerts, AQI, and decisions. */
const REFRESH_INTERVAL_MS = 60_000;

const ConditionsMap = lazy(() =>
  import("@/features/map/conditions-map").then((module) => ({
    default: module.ConditionsMap,
  })),
);

function ConditionsPage(): JSX.Element {
  const { facilities, alerts } = Route.useLoaderData();
  const layers = useMapLayers();
  useRefreshEvery(REFRESH_INTERVAL_MS);
  // A failed radar tile hides radar until the page is left, rather than showing a broken overlay.
  const [radarFailed, setRadarFailed] = useState<boolean>(false);
  const available = MAP_LAYERS.filter(
    (layer) => layer !== "radar" || !radarFailed,
  );
  const active = layers.filter((layer) => available.includes(layer));
  const hideRadar = useCallback((): void => setRadarFailed(true), []);
  const mapFallback = <p>{MAP_LOADING_TEXT}</p>;
  return (
    <section className="space-y-4">
      <h1 className="font-heading font-semibold text-2xl">{PAGE_HEADING}</h1>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <LayerToggles available={available} />
        <PostureLegend />
      </div>
      {alerts === null && (
        <Alert>
          <AlertTitle>{LIVE_UNAVAILABLE_TEXT}</AlertTitle>
        </Alert>
      )}
      <ClientOnly fallback={mapFallback}>
        <Suspense fallback={mapFallback}>
          <ConditionsMap
            alerts={alerts}
            facilities={facilities}
            layers={active}
            onRadarError={hideRadar}
          />
        </Suspense>
      </ClientOnly>
      {alerts !== null && active.includes("alerts") && (
        <UnmappedAlerts alerts={alerts.features} />
      )}
    </section>
  );
}

/** Keeps refreshing, so the page comes back on its own once the API does. */
function ConditionsLoadError(): JSX.Element {
  useRefreshEvery(REFRESH_INTERVAL_MS);
  return (
    <Alert variant="destructive">
      <AlertTitle>{LOAD_ERROR_TEXT}</AlertTitle>
    </Alert>
  );
}

// Router's generator owns this route identifier; it must remain a file-matching literal.
export const Route = createFileRoute("/conditions")({
  validateSearch: validateLayersSearch,
  head: () => ({ meta: [{ title: PAGE_TITLE }] }),
  loader: ({ abortController }) => loadMap({ signal: abortController.signal }),
  component: ConditionsPage,
  pendingComponent: () => <p>{LOADING_TEXT}</p>,
  errorComponent: ConditionsLoadError,
});
