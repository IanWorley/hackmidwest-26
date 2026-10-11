import { type Static, t } from "elysia";
import { CLOSED } from "../schema-options";

const NullableNumber = t.Union([t.Number(), t.Null()]);
const NullableString = t.Union([t.String(), t.Null()]);

const ALERT_SEVERITIES = [
  "Extreme",
  "Severe",
  "Moderate",
  "Minor",
  "Unknown",
] as const;
const ALERT_CERTAINTIES = [
  "Observed",
  "Likely",
  "Possible",
  "Unlikely",
  "Unknown",
] as const;
const ALERT_URGENCIES = [
  "Immediate",
  "Expected",
  "Future",
  "Past",
  "Unknown",
] as const;
const ALERT_MESSAGE_TYPES = [
  "Alert",
  "Update",
  "Cancel",
  "Ack",
  "Error",
] as const;

const AlertSeveritySchema = t.UnionEnum(ALERT_SEVERITIES);
const AlertCertaintySchema = t.UnionEnum(ALERT_CERTAINTIES);
const AlertUrgencySchema = t.UnionEnum(ALERT_URGENCIES);
const AlertMessageTypeSchema = t.UnionEnum(ALERT_MESSAGE_TYPES);

const GeoPointSchema = t.Object({ lat: t.Number(), lon: t.Number() });

/** NWS reports missing hourly data as null values, so every forecast value may be null. */
const ForecastPeriodSchema = t.Object(
  {
    startTime: t.String(),
    endTime: t.String(),
    isDaytime: t.Boolean(),
    temperature: NullableNumber,
    temperatureUnit: NullableString,
    windSpeed: NullableString,
    windDirection: NullableString,
    shortForecast: NullableString,
    probabilityOfPrecipitation: NullableNumber,
  },
  CLOSED,
);

const ForecastSchema = t.Object(
  {
    /** The forecast's own URL, for tracing it back to its source. */
    rawRef: t.String(),
    /** When NWS last updated the forecast; staleness is measured from here. */
    updateTime: t.String(),
    periods: t.Array(ForecastPeriodSchema),
  },
  CLOSED,
);

/**
 * When the hazard applies. `start` is the alert's onset, else its effective time. `end` is its
 * `ends` time, else its `expires` time; `endBasis: "expires"` marks that weaker estimate, so a
 * caller should treat such an end with lower confidence.
 */
const HazardWindowSchema = t.Object(
  {
    start: t.String(),
    end: t.String(),
    endBasis: t.Union([t.Literal("ends"), t.Literal("expires")]),
  },
  CLOSED,
);

const NwsAlertSchema = t.Object(
  {
    id: t.String(),
    event: t.String(),
    headline: NullableString,
    severity: AlertSeveritySchema,
    certainty: AlertCertaintySchema,
    urgency: AlertUrgencySchema,
    messageType: AlertMessageTypeSchema,
    /** Ids of earlier alerts this one updates or cancels. */
    references: t.Array(t.String()),
    hazardWindow: HazardWindowSchema,
  },
  CLOSED,
);

const QuantitySchema = t.Object({
  value: NullableNumber,
  unitCode: t.String(),
});

type GeoPoint = Static<typeof GeoPointSchema>;
type ForecastPeriod = Static<typeof ForecastPeriodSchema>;
type NwsForecast = Static<typeof ForecastSchema>;
type HazardWindow = Static<typeof HazardWindowSchema>;
type NwsAlert = Static<typeof NwsAlertSchema>;
type Quantity = Static<typeof QuantitySchema>;

interface NwsObservation {
  readonly stationId: string;
  readonly timestamp: string;
  /** The observation's own URL, for tracing a reading back to its source. */
  readonly rawRef: string;
  readonly temperature: Quantity;
  readonly windSpeed: Quantity;
  readonly windGust: Quantity;
  readonly visibility: Quantity;
}

interface AlertTimes {
  readonly effective: string;
  readonly onset: string | null;
  readonly ends: string | null;
  readonly expires: string;
}

function hazardWindow({
  effective,
  onset,
  ends,
  expires,
}: AlertTimes): HazardWindow {
  const start = onset ?? effective;
  if (ends === null) {
    return { start, end: expires, endBasis: "expires" };
  }
  return { start, end: ends, endBasis: "ends" };
}

export type { ForecastPeriod, GeoPoint, NwsAlert, NwsForecast, NwsObservation };
export {
  ALERT_URGENCIES,
  AlertCertaintySchema,
  AlertMessageTypeSchema,
  AlertSeveritySchema,
  AlertUrgencySchema,
  ForecastPeriodSchema,
  ForecastSchema,
  GeoPointSchema,
  hazardWindow,
  NullableNumber,
  NullableString,
  NwsAlertSchema,
  QuantitySchema,
};
