import type { Hazard, RoadClass } from "@hackmidwest/db";
import type { Posture } from "./postures";

const HIGH_WIND_SUSTAINED_MPH = 40;
const HIGH_WIND_SUSTAINED_DURATION_MINUTES = 60;
const HIGH_WIND_GUST_MPH = 58;
const HIGH_WIND_GUST_DURATION_MINUTES = 0;
const AQI_UNHEALTHY = 151;
const AQI_VERY_UNHEALTHY = 201;
const SUPER_COMMUTER_BARE_LANE_REGAIN_MINUTES = 180;
const URBAN_COMMUTER_BARE_LANE_REGAIN_MINUTES = 300;
const RURAL_COMMUTER_BARE_LANE_REGAIN_MINUTES = 540;
const PRIMARY_BARE_LANE_REGAIN_MINUTES = 720;
const SECONDARY_BARE_LANE_REGAIN_MINUTES = 2160;
const WIND_POST_HAZARD_BUFFER_MINUTES = 60;
const CAMS_GLOBAL_TIME_STEP_MINUTES = 180;
const OPM_LONGEST_ILLUSTRATED_DELAY_HOURS = 4;
const OPM_STANDARD_DELAY_HOURS = 2;
const OPM_WHOLE_HOUR_DELAY_MINUTES = 60;
const QUARTER_HOUR_MINUTES = 15;
const DISMISSAL_MARGIN_MINUTES = 30;
const HOURLY_OBSERVATION_STALE_MINUTES = 90;
const FORECAST_STALE_MINUTES = 360;
const CAMS_REFRESH_MINUTES = 720;

const NWSI_10_513_SOURCE =
  "National Weather Service, NWSI 10-513 WFO Winter Weather Products Specification (November 6, 2024), with OASIS CAP v1.2 severity as served by api.weather.gov";
const NWSI_10_513_URL =
  "https://www.weather.gov/media/directives/010_pdfs/pd01005013curr.pdf";
const NWSI_10_515_SOURCE =
  "National Weather Service, NWSI 10-515 WFO Non-Precipitation Weather Products Specification (May 16, 2025)";
const NWSI_10_515_URL =
  "https://www.weather.gov/media/directives/010_pdfs/pd01005015curr.pdf";
const CAP_V1_2_URL =
  "https://docs.oasis-open.org/emergency/cap/v1.2/CAP-v1.2-os.html";
const MNDOT_CLEAR_ROADS_SOURCE =
  "Minnesota Department of Transportation, Maintenance Manual Chapter 2: Clear Roads (November 15, 2023); Minnesota trunk-highway targets, applied as a proxy for commute roads in other states";
const MNDOT_CLEAR_ROADS_URL =
  "https://www.dot.state.mn.us/maintenance/pdf/manual/CHAPTER%202%2011-15-23.pdf";
const AIRNOW_AQI_SOURCE = "U.S. EPA AirNow, AQI Basics";
const AIRNOW_AQI_URL = "https://www.airnow.gov/aqi/aqi-basics/";
const OPM_SOURCE =
  "U.S. Office of Personnel Management, Governmentwide Dismissal and Closure Procedures (December 2025)";
const OPM_URL =
  "https://www.opm.gov/policy-data-oversight/pay-leave/reference-materials/handbooks/dcdismissal.pdf";
const OPEN_METEO_AIR_QUALITY_URL =
  "https://open-meteo.com/en/docs/air-quality-api";
const CLOSURE_CALL_POLICY_SOURCE = "Closure Call policy";

// CAP v1.2 lists these most severe first; ascending order lets an index
// comparison rank severity, with Unknown lowest.
export const NWS_SEVERITIES = [
  "Unknown",
  "Minor",
  "Moderate",
  "Severe",
  "Extreme",
] as const;

export type NwsSeverity = (typeof NWS_SEVERITIES)[number];

export interface CitedValue<Unit extends string, Value = number> {
  readonly value: Value;
  readonly unit: Unit;
  readonly source: string;
  readonly citation: string;
}

// A severity cutoff only applies to the listed NWS events, because other
// products (Wind Advisory, Winter Storm Watch) share the same CAP severities.
export interface AlertCutoff extends CitedValue<"nws_severity", NwsSeverity> {
  readonly events: readonly [string, ...string[]];
}

export const WIND_METRICS = ["wind_sustained", "wind_gust"] as const;

export type WindMetric = (typeof WIND_METRICS)[number];

export interface WindCutoff extends CitedValue<"mph"> {
  readonly metric: WindMetric;
  readonly minDurationMinutes: number;
}

/** `value` is an inclusive minimum: a reading at or above it crosses the cutoff. */
export type Cutoff = (AlertCutoff | WindCutoff | CitedValue<"aqi">) & {
  readonly posture: Exclude<Posture, "normal">;
};

export interface HazardThresholds {
  readonly cutoffs: Readonly<Record<string, Cutoff>>;
  readonly postHazardBufferMinutes:
    | CitedValue<"minutes">
    | Readonly<Record<RoadClass, CitedValue<"minutes">>>;
  readonly maxDelayHours: CitedValue<"hours">;
}

export const THRESHOLDS = {
  winter: {
    cutoffs: {
      stormWarning: {
        value: "Severe",
        unit: "nws_severity",
        events: [
          "Winter Storm Warning",
          "Blizzard Warning",
          "Ice Storm Warning",
          "Lake Effect Snow Warning",
        ],
        posture: "full_closure",
        source: NWSI_10_513_SOURCE,
        citation: `Table 1: Winter Weather Products lists these four warnings. Winter Storm Warnings on api.weather.gov carry CAP severity "Severe", which CAP v1.2 §3.2.2 defines as "Significant threat to life or property". ${NWSI_10_513_URL} ${CAP_V1_2_URL}`,
      },
      advisory: {
        value: "Moderate",
        unit: "nws_severity",
        events: ["Winter Weather Advisory"],
        posture: "delayed_arrival",
        source: NWSI_10_513_SOURCE,
        citation: `Table 1: Winter Weather Products lists the Winter Weather Advisory for events meeting advisory but not warning criteria. Winter Weather Advisories on api.weather.gov carry CAP severity "Moderate", which CAP v1.2 §3.2.2 defines as "Possible threat to life or property". ${NWSI_10_513_URL} ${CAP_V1_2_URL}`,
      },
    },
    postHazardBufferMinutes: {
      superCommuter: {
        value: SUPER_COMMUTER_BARE_LANE_REGAIN_MINUTES,
        unit: "minutes",
        source: MNDOT_CLEAR_ROADS_SOURCE,
        citation: `§2-5.02 and Table 2: Bare Lane Regain Time, measured from the end of the event, targets 0-3 hrs for Super Commuter routes (AADT over 30,000). The buffer takes the 3-hour upper bound. ${MNDOT_CLEAR_ROADS_URL}`,
      },
      urbanCommuter: {
        value: URBAN_COMMUTER_BARE_LANE_REGAIN_MINUTES,
        unit: "minutes",
        source: MNDOT_CLEAR_ROADS_SOURCE,
        citation: `§2-5.02 and Table 2: Bare Lane Regain Time, measured from the end of the event, targets 2-5 hrs for Urban Commuter routes (AADT 10,000-30,000). The buffer takes the 5-hour upper bound. ${MNDOT_CLEAR_ROADS_URL}`,
      },
      ruralCommuter: {
        value: RURAL_COMMUTER_BARE_LANE_REGAIN_MINUTES,
        unit: "minutes",
        source: MNDOT_CLEAR_ROADS_SOURCE,
        citation: `§2-5.02 and Table 2: Bare Lane Regain Time, measured from the end of the event, targets 4-9 hrs for Rural Commuter routes (AADT 2,000-10,000). The buffer takes the 9-hour upper bound. ${MNDOT_CLEAR_ROADS_URL}`,
      },
      primary: {
        value: PRIMARY_BARE_LANE_REGAIN_MINUTES,
        unit: "minutes",
        source: MNDOT_CLEAR_ROADS_SOURCE,
        citation: `§2-5.02 and Table 2: Bare Lane Regain Time, measured from the end of the event, targets 6-12 hrs for Primary routes (AADT 800-2,000). The buffer takes the 12-hour upper bound. ${MNDOT_CLEAR_ROADS_URL}`,
      },
      secondary: {
        value: SECONDARY_BARE_LANE_REGAIN_MINUTES,
        unit: "minutes",
        source: MNDOT_CLEAR_ROADS_SOURCE,
        citation: `§2-5.02 and Table 2: Bare Lane Regain Time, measured from the end of the event, targets 9-36 hrs for Secondary routes (AADT under 800). The buffer takes the 36-hour upper bound. ${MNDOT_CLEAR_ROADS_URL}`,
      },
    },
    maxDelayHours: {
      value: OPM_LONGEST_ILLUSTRATED_DELAY_HOURS,
      unit: "hours",
      source: OPM_SOURCE,
      citation: `§IV.B.3 Option 3b, Example 1: after a snowstorm, a report-by-11:00 delayed arrival gives an employee who starts at 7:00 at most 4 hours. The procedures set no fixed cap, and 4 hours is the longest delay they illustrate, so a longer hazard calls for telework or closure. ${OPM_URL}`,
    },
  },
  wind: {
    cutoffs: {
      sustained: {
        value: HIGH_WIND_SUSTAINED_MPH,
        unit: "mph",
        metric: "wind_sustained",
        minDurationMinutes: HIGH_WIND_SUSTAINED_DURATION_MINUTES,
        posture: "early_dismissal",
        source: NWSI_10_515_SOURCE,
        citation: `§6.2.3 Table 1, High Wind Warning: typical values are sustained wind speeds of 40 mph or greater lasting for 1 hour or longer. WFOs may define local criteria. ${NWSI_10_515_URL}`,
      },
      gust: {
        value: HIGH_WIND_GUST_MPH,
        unit: "mph",
        metric: "wind_gust",
        minDurationMinutes: HIGH_WIND_GUST_DURATION_MINUTES,
        posture: "full_closure",
        source: NWSI_10_515_SOURCE,
        citation: `§6.2.3 Table 1, High Wind Warning: typical values include winds of 58 mph or greater for any duration. WFOs may define local criteria. ${NWSI_10_515_URL}`,
      },
    },
    postHazardBufferMinutes: {
      value: WIND_POST_HAZARD_BUFFER_MINUTES,
      unit: "minutes",
      source:
        "Closure Call policy; no NWS or OPM standard sets a buffer after wind ends",
      citation:
        "Policy choice: one hour after winds drop below warning criteria gives crews time to report downed trees and power lines on commute routes before employees leave.",
    },
    maxDelayHours: {
      value: OPM_STANDARD_DELAY_HOURS,
      unit: "hours",
      source: OPM_SOURCE,
      citation: `Policy choice: OPM sets no cap. §IV.B.3 Option 3a, Example 1 illustrates a 2-hour delayed arrival (8:00 to 10:00). Wind damage that takes longer than that to clear calls for telework or closure instead. ${OPM_URL}`,
    },
  },
  airQuality: {
    cutoffs: {
      unhealthy: {
        value: AQI_UNHEALTHY,
        unit: "aqi",
        posture: "unscheduled_telework",
        source: AIRNOW_AQI_SOURCE,
        citation: `AQI 151 to 200 is "Unhealthy": some members of the general public may experience health effects. ${AIRNOW_AQI_URL}`,
      },
      veryUnhealthy: {
        value: AQI_VERY_UNHEALTHY,
        unit: "aqi",
        posture: "full_closure",
        source: AIRNOW_AQI_SOURCE,
        citation: `AQI 201 to 300 is "Very Unhealthy": health alert, the risk of health effects is increased for everyone. ${AIRNOW_AQI_URL}`,
      },
    },
    postHazardBufferMinutes: {
      value: CAMS_GLOBAL_TIME_STEP_MINUTES,
      unit: "minutes",
      source:
        "Open-Meteo Air Quality API, CAMS Global Atmospheric Composition Forecasts",
      citation: `US AQI comes from the CAMS global model at 3-hourly resolution, refreshed every 12 hours. The buffer waits one 3-hour model step to confirm AQI stays below the cutoff. ${OPEN_METEO_AIR_QUALITY_URL}`,
    },
    maxDelayHours: {
      value: OPM_STANDARD_DELAY_HOURS,
      unit: "hours",
      source: OPM_SOURCE,
      citation: `Policy choice: §I lists poor air quality among the disruptions the procedures cover, and §IV.B.3 Option 3a, Example 1 illustrates a 2-hour delayed arrival. Smoke rarely clears within a morning, so an event longer than 2 hours calls for telework or closure. ${OPM_URL}`,
    },
  },
} as const satisfies Record<Hazard, HazardThresholds>;

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
    source:
      "Open-Meteo Air Quality API, CAMS Global Atmospheric Composition Forecasts",
    citation: `The CAMS global model behind US AQI is refreshed every 12 hours, so an AQI value older than one refresh has missed an update. ${OPEN_METEO_AIR_QUALITY_URL}`,
  },
} as const satisfies Record<string, CitedValue<"minutes">>;

export function postHazardBuffer(
  hazard: Hazard,
  roadClass: RoadClass,
): CitedValue<"minutes"> {
  const buffer: HazardThresholds["postHazardBufferMinutes"] =
    THRESHOLDS[hazard].postHazardBufferMinutes;
  if ("value" in buffer) {
    return buffer;
  }
  return buffer[roadClass];
}
