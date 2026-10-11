import "leaflet/dist/leaflet.css";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import {
  divIcon,
  type FitBoundsOptions,
  type LatLngBounds,
  type LatLngTuple,
  latLngBounds,
} from "leaflet";
import type { JSX } from "react";
import {
  GeoJSON,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
} from "react-leaflet";
import { POSTURE_CLASSES } from "@/features/closure/posture";
import {
  AsOfMarker,
  DecideByCountdown,
  PostureBadge,
} from "@/features/closure/posture-fields";
import { ALERT_SEVERITY_CLASSES } from "./alert-severity";
import { aqiCategory } from "./aqi";
import type { MapLayer } from "./layers";
import type { AlertFeature, MapData, MapFacility, Standing } from "./load-map";
import { BASE_TILES, RADAR_TILES } from "./tiles";

const MARKER_SIZE_PX = 18;
const LABEL_OFFSET_PX = 12;
const FIT_PADDING_PX = 48;
const FIT_MAX_ZOOM = 8;
const RADAR_OPACITY = 0.6;
const ALERT_FILL_OPACITY = 0.35;
const CONTIGUOUS_US_SOUTH_LAT = 24.5;
const CONTIGUOUS_US_WEST_LON = -125;
const CONTIGUOUS_US_NORTH_LAT = 49.4;
const CONTIGUOUS_US_EAST_LON = -66.9;
const DECIDED_TEXT = "Decided";
const OPEN_FACILITY_PREFIX = "Open";
const HAZARD_WINDOW_SEPARATOR = " → ";
const AQI_SEPARATOR = " · ";
const MARKER_CLASS = "rounded-full border-2 border-white shadow-md";
const AQI_RING_CLASS = "ring-4";
const FIT_OPTIONS: FitBoundsOptions = {
  padding: [FIT_PADDING_PX, FIT_PADDING_PX],
  maxZoom: FIT_MAX_ZOOM,
};
const HAZARD_TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** With no facilities there is nothing to fit, so the map frames the contiguous US. */
function initialBounds(facilities: readonly MapFacility[]): LatLngBounds {
  if (facilities.length === 0) {
    return latLngBounds([
      [CONTIGUOUS_US_SOUTH_LAT, CONTIGUOUS_US_WEST_LON],
      [CONTIGUOUS_US_NORTH_LAT, CONTIGUOUS_US_EAST_LON],
    ]);
  }
  return latLngBounds(
    facilities.map(({ lat, lon }): LatLngTuple => [lat, lon]),
  );
}

function aqiRingClass(facility: MapFacility, showAqi: boolean): string {
  if (!showAqi || facility.aqi === null) {
    return "";
  }
  return cn(AQI_RING_CLASS, aqiCategory(facility.aqi.value).ringClassName);
}

function DecisionStatus({
  standing,
}: {
  standing: Standing;
}): JSX.Element | null {
  if (standing.posture === "not_evaluated") {
    return null;
  }
  if (standing.decided) {
    return <span className="text-xs">{DECIDED_TEXT}</span>;
  }
  return (
    <>
      <DecideByCountdown decideBy={standing.decideBy} />
      <AsOfMarker asOf={standing.asOf} mode={standing.mode} />
    </>
  );
}

function AqiText({
  facility,
  showAqi,
}: {
  facility: MapFacility;
  showAqi: boolean;
}): JSX.Element | null {
  if (!showAqi || facility.aqi === null) {
    return null;
  }
  const { value } = facility.aqi;
  return (
    <span className="text-xs">
      {`AQI ${Math.round(value)}${AQI_SEPARATOR}${aqiCategory(value).label}`}
    </span>
  );
}

function FacilityMarker({
  facility,
  showAqi,
}: {
  facility: MapFacility;
  showAqi: boolean;
}): JSX.Element {
  const icon = divIcon({
    className: cn(
      MARKER_CLASS,
      POSTURE_CLASSES[facility.standing.posture],
      aqiRingClass(facility, showAqi),
    ),
    iconSize: [MARKER_SIZE_PX, MARKER_SIZE_PX],
  });
  return (
    <Marker
      icon={icon}
      position={[facility.lat, facility.lon]}
      title={facility.name}
    >
      <Tooltip direction="right" offset={[LABEL_OFFSET_PX, 0]} permanent={true}>
        <div className="flex flex-col items-start gap-1">
          <span className="font-medium">{facility.name}</span>
          <PostureBadge posture={facility.standing.posture} />
          <DecisionStatus standing={facility.standing} />
          <AqiText facility={facility} showAqi={showAqi} />
        </div>
      </Tooltip>
      <Popup>
        <Link
          params={{ facilityId: String(facility.id) }}
          to="/facilities/$facilityId"
        >
          {`${OPEN_FACILITY_PREFIX} ${facility.name}`}
        </Link>
      </Popup>
    </Marker>
  );
}

function AlertArea({ alert }: { alert: AlertFeature }): JSX.Element | null {
  if (alert.geometry === null) {
    return null;
  }
  const { event, severity, onset, ends } = alert.properties;
  return (
    <GeoJSON
      data={alert.geometry}
      style={{
        className: ALERT_SEVERITY_CLASSES[severity],
        fillOpacity: ALERT_FILL_OPACITY,
      }}
    >
      <Tooltip sticky={true}>
        <div className="flex flex-col">
          <span className="font-medium">{event}</span>
          <span>
            {HAZARD_TIME_FORMAT.format(Date.parse(onset))}
            {HAZARD_WINDOW_SEPARATOR}
            {HAZARD_TIME_FORMAT.format(Date.parse(ends))}
          </span>
        </div>
      </Tooltip>
    </GeoJSON>
  );
}

/** Leaflet reads `window` on import, so routes load this module only in the browser. */
export function ConditionsMap({
  facilities,
  alerts,
  layers,
  onRadarError,
}: {
  facilities: MapData["facilities"];
  alerts: MapData["alerts"];
  layers: readonly MapLayer[];
  onRadarError: () => void;
}): JSX.Element {
  const showAqi = layers.includes("aqi");
  return (
    <MapContainer
      bounds={initialBounds(facilities)}
      boundsOptions={FIT_OPTIONS}
      className="h-128 w-full rounded-lg border"
    >
      <TileLayer attribution={BASE_TILES.attribution} url={BASE_TILES.url} />
      {layers.includes("radar") && (
        <TileLayer
          attribution={RADAR_TILES.attribution}
          eventHandlers={{ tileerror: onRadarError }}
          opacity={RADAR_OPACITY}
          url={RADAR_TILES.url}
        />
      )}
      {layers.includes("alerts") &&
        alerts.features.map((alert) => (
          <AlertArea alert={alert} key={alert.id} />
        ))}
      {facilities.map((facility) => (
        <FacilityMarker
          facility={facility}
          key={facility.id}
          showAqi={showAqi}
        />
      ))}
    </MapContainer>
  );
}
