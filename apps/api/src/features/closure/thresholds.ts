import type { Posture } from "./postures";

const HIGH_WIND_SUSTAINED_MPH = 40;
const HIGH_WIND_GUST_MPH = 58;
const AQI_UNHEALTHY = 151;
const AQI_VERY_UNHEALTHY = 201;
const SUPER_COMMUTER_BARE_LANE_REGAIN_MINUTES = 180;
const HIGH_WIND_CRITERION_DURATION_MINUTES = 60;
const AIRNOW_UPDATE_INTERVAL_MINUTES = 60;
const OPM_LONGEST_ILLUSTRATED_DELAY_HOURS = 4;
const OPM_STANDARD_DELAY_HOURS = 2;

const NWS_ALERTS_SOURCE =
  "National Weather Service, api.weather.gov alerts (OASIS CAP v1.2 severity field)";
const NWSI_10_515_SOURCE =
  "National Weather Service, NWSI 10-515 WFO Non-Precipitation Weather Products Specification (May 16, 2025)";
const NWSI_10_515_URL =
  "https://www.weather.gov/media/directives/010_pdfs/pd01005015curr.pdf";
const CAP_V1_2_URL =
  "https://docs.oasis-open.org/emergency/cap/v1.2/CAP-v1.2-os.html";
const AIRNOW_AQI_SOURCE = "U.S. EPA AirNow, AQI Basics";
const AIRNOW_AQI_URL = "https://www.airnow.gov/aqi/aqi-basics/";
const OPM_SOURCE =
  "U.S. Office of Personnel Management, Governmentwide Dismissal and Closure Procedures (December 2025)";
const OPM_URL =
  "https://www.opm.gov/policy-data-oversight/pay-leave/reference-materials/handbooks/dcdismissal.pdf";

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

export const HAZARDS = ["winter", "wind", "airQuality"] as const;

export type Hazard = (typeof HAZARDS)[number];

export interface CitedValue<Unit extends string, Value = number> {
  readonly value: Value;
  readonly unit: Unit;
  readonly source: string;
  readonly citation: string;
}

export type Cutoff = (
  | CitedValue<"nws_severity", NwsSeverity>
  | CitedValue<"mph">
  | CitedValue<"aqi">
) & { readonly posture: Posture };

export interface HazardThresholds {
  readonly cutoffs: Readonly<Record<string, Cutoff>>;
  readonly postHazardBufferMinutes: CitedValue<"minutes">;
  readonly maxDelayHours: CitedValue<"hours">;
}

export const THRESHOLDS = {
  winter: {
    cutoffs: {
      stormWarning: {
        value: "Severe",
        unit: "nws_severity",
        posture: "full_closure",
        source: NWS_ALERTS_SOURCE,
        citation: `Winter Storm Warning alerts carry CAP severity "Severe", defined in CAP v1.2 §3.2.2 as "Significant threat to life or property". https://api.weather.gov/alerts?event=Winter%20Storm%20Warning ${CAP_V1_2_URL}`,
      },
      advisory: {
        value: "Moderate",
        unit: "nws_severity",
        posture: "delayed_arrival",
        source: NWS_ALERTS_SOURCE,
        citation: `Winter Weather Advisory alerts carry CAP severity "Moderate", defined in CAP v1.2 §3.2.2 as "Possible threat to life or property". https://api.weather.gov/alerts?event=Winter%20Weather%20Advisory ${CAP_V1_2_URL}`,
      },
    },
    postHazardBufferMinutes: {
      value: SUPER_COMMUTER_BARE_LANE_REGAIN_MINUTES,
      unit: "minutes",
      source:
        "Minnesota Department of Transportation, Maintenance Manual Chapter 2: Clear Roads (November 15, 2023)",
      citation:
        "§2-5.02 and Table 2: the target Bare Lane Regain Time, measured from the end of the event, is 0-3 hrs for Super Commuter routes (AADT over 30,000). The buffer takes the 3-hour upper bound for the busiest commuter routes. https://www.dot.state.mn.us/maintenance/pdf/manual/CHAPTER%202%2011-15-23.pdf",
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
        posture: "early_dismissal",
        source: NWSI_10_515_SOURCE,
        citation: `§6.2.2.2 High Wind Warning: typical values are sustained wind speeds of 40 mph or greater lasting for 1 hour or longer. ${NWSI_10_515_URL}`,
      },
      gust: {
        value: HIGH_WIND_GUST_MPH,
        unit: "mph",
        posture: "full_closure",
        source: NWSI_10_515_SOURCE,
        citation: `§6.2.2.2 High Wind Warning: typical values include winds of 58 mph or greater for any duration. ${NWSI_10_515_URL}`,
      },
    },
    postHazardBufferMinutes: {
      value: HIGH_WIND_CRITERION_DURATION_MINUTES,
      unit: "minutes",
      source: NWSI_10_515_SOURCE,
      citation: `§6.2.2.2 defines High Wind Warning sustained winds as lasting 1 hour or longer, and §2.3 ends an event when criteria are forecast to no longer be met. The buffer waits one criterion duration so a lull is not read as the end. ${NWSI_10_515_URL}`,
    },
    maxDelayHours: {
      value: OPM_STANDARD_DELAY_HOURS,
      unit: "hours",
      source: OPM_SOURCE,
      citation: `§IV.B.3 Option 3a, Example 1: a 2-hour delayed arrival moves an 8:00 arrival to 10:00. Roads need no treatment after wind ends, so the standard 2-hour delay applies, and a longer event calls for telework or closure. ${OPM_URL}`,
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
      value: AIRNOW_UPDATE_INTERVAL_MINUTES,
      unit: "minutes",
      source: "U.S. EPA AirNow API, Hourly AQ Obs Fact Sheet (March 2023)",
      citation:
        "The data file is updated once per hour (at ~:35 minutes past the hour). The buffer waits one hourly update to confirm AQI stays below the cutoff. https://docs.airnowapi.org/docs/HourlyAQObsFactSheet.pdf",
    },
    maxDelayHours: {
      value: OPM_STANDARD_DELAY_HOURS,
      unit: "hours",
      source: OPM_SOURCE,
      citation: `§I lists poor air quality among the disruptions the procedures cover, and §IV.B.3 Option 3a, Example 1 illustrates a 2-hour delayed arrival. A longer event calls for telework or closure. ${OPM_URL}`,
    },
  },
} as const satisfies Record<Hazard, HazardThresholds>;
