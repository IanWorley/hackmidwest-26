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
import { type JSX, useEffect } from "react";
import {
  GeoJSON,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import {
  DECISION_STATUSES,
  decisionDeadline,
  effectivePosture,
} from "@/features/closure/decision-status";
import { POSTURE_CLASSES, POSTURE_LABELS } from "@/features/closure/posture";
import {
  AsOfMarker,
  DecideByCountdown,
  PostureBadge,
} from "@/features/closure/posture-fields";
import { ALERT_SEVERITY_CLASSES } from "./alert-severity";
import { aqiCategory } from "./aqi";
import { hazardWindowText } from "./hazard-window";
import type { MapLayer } from "./layers";
import type {
  AlertCollection,
  AlertFeature,
  EvaluatedStanding,
  MapData,
  MapFacility,
  Standing,
  StandingPosture,
} from "./load-map";
import { AQI_ATTRIBUTION, BASE_TILES, RADAR_TILES } from "./tiles";

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
const RECOMMENDED_PREFIX = "Recommended:";
const AQI_PREFIX = "Modeled AQI";
const OPEN_FACILITY_PREFIX = "Open";
const AQI_SEPARATOR = " · ";
const AQI_UNAVAILABLE_TEXT = "Modeled AQI unavailable";
/** The reading's own hour, in UTC like the evaluation stamp, since it can be older than the standing. */
const AQI_TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});
const MARKER_CLASS = "rounded-full border-2 border-white shadow-md";
const AQI_RING_CLASS = "ring-4";
const FIT_OPTIONS: FitBoundsOptions = {
  padding: [FIT_PADDING_PX, FIT_PADDING_PX],
  maxZoom: FIT_MAX_ZOOM,
};

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

/** The posture in effect, so a pin reflects a decision that changed the recommendation. */
function pinPosture(standing: Standing): StandingPosture {
  if (standing.posture === "not_evaluated") {
    return standing.posture;
  }
  return effectivePosture(standing);
}

function RecommendedPosture({
  standing,
}: {
  standing: EvaluatedStanding;
}): JSX.Element | null {
  if (effectivePosture(standing) === standing.posture) {
    return null;
  }
  return (
    <span className="text-muted-foreground text-xs">
      {`${RECOMMENDED_PREFIX} ${POSTURE_LABELS[standing.posture]}`}
    </span>
  );
}

function DecisionDeadline({
  standing,
}: {
  standing: EvaluatedStanding;
}): JSX.Element {
  const { decision } = standing;
  const deadline = decisionDeadline(standing);
  if (decision === null) {
    return <DecideByCountdown decideBy={deadline} />;
  }
  const { label, awaitsDecision } = DECISION_STATUSES[decision.action];
  const statusText = <span className="text-xs">{label}</span>;
  if (!awaitsDecision) {
    return statusText;
  }
  return (
    <>
      {statusText}
      <DecideByCountdown decideBy={deadline} />
    </>
  );
}

function StandingDetails({
  standing,
}: {
  standing: Standing;
}): JSX.Element | null {
  if (standing.posture === "not_evaluated") {
    return null;
  }
  return (
    <>
      <RecommendedPosture standing={standing} />
      <DecisionDeadline standing={standing} />
      <AsOfMarker asOf={standing.asOf} />
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
  if (!showAqi) {
    return null;
  }
  if (facility.aqi === null) {
    return <span className="text-xs">{AQI_UNAVAILABLE_TEXT}</span>;
  }
  const { value, observedAt } = facility.aqi;
  return (
    <span className="text-xs">
      {`${AQI_PREFIX} ${Math.round(value)}${AQI_SEPARATOR}${aqiCategory(value).label}${AQI_SEPARATOR}${AQI_TIME_FORMAT.format(Date.parse(observedAt))}`}
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
  const posture = pinPosture(facility.standing);
  const icon = divIcon({
    className: cn(
      MARKER_CLASS,
      POSTURE_CLASSES[posture],
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
          <PostureBadge posture={posture} />
          <StandingDetails standing={facility.standing} />
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
          <span>{hazardWindowText(onset, ends)}</span>
        </div>
      </Tooltip>
    </GeoJSON>
  );
}

/** Credits the modeled AQI in the map's attribution while the layer is on. */
function AqiAttribution(): null {
  const map = useMap();
  useEffect(() => {
    const control = map.attributionControl;
    control.addAttribution(AQI_ATTRIBUTION);
    return (): void => {
      control.removeAttribution(AQI_ATTRIBUTION);
    };
  }, [map]);
  return null;
}

/** Leaflet reads `window` on import, so routes load this module only in the browser. */
export function ConditionsMap({
  facilities,
  alerts,
  layers,
  onRadarError,
}: {
  facilities: MapData["facilities"];
  alerts: AlertCollection | null;
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
      {showAqi && <AqiAttribution />}
      {layers.includes("alerts") &&
        alerts?.features.map((alert) => (
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
