import {
  type CitedValue,
  OPEN_METEO_AIR_QUALITY_SOURCE,
  OPEN_METEO_AIR_QUALITY_URL,
  OPM_SOURCE,
  OPM_URL,
} from "./thresholds";

const OPM_WHOLE_HOUR_DELAY_MINUTES = 60;
const QUARTER_HOUR_MINUTES = 15;
const DISMISSAL_MARGIN_MINUTES = 30;
const HOURLY_OBSERVATION_STALE_MINUTES = 90;
const FORECAST_STALE_MINUTES = 360;
const CAMS_REFRESH_MINUTES = 720;

const CLOSURE_CALL_POLICY_SOURCE = "Closure Call policy";

/** Policy values that turn a hazard window into an OPM-style status. */
export const TIMING_POLICY = {
  delayIncrementMinutes: {
    value: OPM_WHOLE_HOUR_DELAY_MINUTES,
    unit: "minutes",
    source: OPM_SOURCE,
    citation: `§IV.B.3 Options 3a and 3b illustrate delayed arrivals in whole hours (2 hours, 4 hours), so a partial hour of delay rounds up to the next hour. ${OPM_URL}`,
  },
  releaseIncrementMinutes: {
    value: QUARTER_HOUR_MINUTES,
    unit: "minutes",
    source: CLOSURE_CALL_POLICY_SOURCE,
    citation:
      "Policy choice: an early-dismissal departure time rounds down to the quarter hour so it reads like an announced time, and rounding down only releases employees earlier.",
  },
  dismissalMarginMinutes: {
    value: DISMISSAL_MARGIN_MINUTES,
    unit: "minutes",
    source: CLOSURE_CALL_POLICY_SOURCE,
    citation:
      "Policy choice: employees released early should be home 30 minutes before hazard onset, to absorb error in the forecast onset time. This is separate from the post-hazard buffer, which measures road recovery after the event ends.",
  },
  observationStaleMinutes: {
    value: HOURLY_OBSERVATION_STALE_MINUTES,
    unit: "minutes",
    source: CLOSURE_CALL_POLICY_SOURCE,
    citation:
      "Policy choice: NWS stations report hourly, so an observation older than one report cycle plus 30 minutes of reporting latency has missed an update.",
  },
  forecastStaleMinutes: {
    value: FORECAST_STALE_MINUTES,
    unit: "minutes",
    source: CLOSURE_CALL_POLICY_SOURCE,
    citation:
      "Policy choice: NWS publishes no staleness limit for the hourly forecast. A forecast more than 6 hours old lowers confidence in the hazard window it supplies.",
  },
  airQualityStaleMinutes: {
    value: CAMS_REFRESH_MINUTES,
    unit: "minutes",
    source: OPEN_METEO_AIR_QUALITY_SOURCE,
    citation: `The CAMS global model behind US AQI is refreshed every 12 hours, so an AQI value older than one refresh has missed an update. ${OPEN_METEO_AIR_QUALITY_URL}`,
  },
} as const satisfies Record<string, CitedValue<"minutes">>;
