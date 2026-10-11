import type { Hazard } from "@hackmidwest/db";
import type { FloodCategory } from "../../clients/nwps";
import type { Posture } from "./postures";

const HIGH_WIND_SUSTAINED_MPH = 40;
const HIGH_WIND_SUSTAINED_DURATION_MINUTES = 60;
const HIGH_WIND_GUST_MPH = 58;
const HIGH_WIND_GUST_DURATION_MINUTES = 0;
const AQI_UNHEALTHY = 151;
const AQI_VERY_UNHEALTHY = 201;
const URBAN_COMMUTER_BARE_LANE_REGAIN_MINUTES = 300;
const WIND_POST_HAZARD_BUFFER_MINUTES = 60;
const CAMS_GLOBAL_TIME_STEP_MINUTES = 180;
const OPM_LONGEST_ILLUSTRATED_DELAY_HOURS = 4;
const OPM_STANDARD_DELAY_HOURS = 2;
const NWPS_FORECAST_STEP_MINUTES = 360;

const NWSI_10_513_SOURCE =
  "National Weather Service, NWSI 10-513 WFO Winter Weather Products Specification (November 6, 2024), with OASIS CAP v1.2 severity as served by api.weather.gov";
const NWSI_10_513_URL =
  "https://www.weather.gov/media/directives/010_pdfs/pd01005013curr.pdf";
const NWSI_10_515_SOURCE =
  "National Weather Service, NWSI 10-515 WFO Non-Precipitation Weather Products Specification (May 16, 2025)";
const NWSI_10_515_URL =
  "https://www.weather.gov/media/directives/010_pdfs/pd01005015curr.pdf";
const NWSI_10_922_SOURCE =
  "National Weather Service, NWSI 10-922 Weather Forecast Office Water Resources Products Specification (August 3, 2021), with OASIS CAP v1.2 severity as served by api.weather.gov";
const NWSI_10_922_URL =
  "https://www.weather.gov/media/directives/010_pdfs/pd01009022curr.pdf";
const NWSM_10_950_SOURCE =
  "National Weather Service, NWSM 10-950 Definitions and General Terminology (November 26, 2019), with each gauge's flood stages from the NWS National Water Prediction Service";
const NWSM_10_950_URL =
  "https://www.weather.gov/media/directives/010_pdfs/pd01009050curr.pdf";
const NWPS_GAUGE_URL = "https://api.water.noaa.gov/nwps/v1/gauges/{lid}";
const NWS_AFTER_FLOOD_URL = "https://www.weather.gov/safety/flood-after";
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

// The category, not a stage: each gauge's NWPS record sets its own stage per category.
export type GaugeCutoff = CitedValue<"nws_flood_category", FloodCategory>;

/** `value` is an inclusive minimum: a reading at or above it crosses the cutoff. */
export type Cutoff = (
  | AlertCutoff
  | WindCutoff
  | GaugeCutoff
  | CitedValue<"aqi">
) & {
  readonly posture: Exclude<Posture, "normal">;
};

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
      value: URBAN_COMMUTER_BARE_LANE_REGAIN_MINUTES,
      unit: "minutes",
      source:
        "Minnesota Department of Transportation, Maintenance Manual Chapter 2: Clear Roads (November 15, 2023)",
      citation:
        "§2-5.02 and Table 2: the target Bare Lane Regain Time, measured from the end of the event, is 0-3 hrs for Super Commuter routes (AADT over 30,000), 2-5 hrs for Urban Commuter (10,000-30,000), and 4-9 hrs for Rural Commuter (2,000-10,000). The buffer takes the 5-hour Urban Commuter upper bound as a metro default; a facility served by rural roads needs longer. https://www.dot.state.mn.us/maintenance/pdf/manual/CHAPTER%202%2011-15-23.pdf",
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
      citation:
        "US AQI comes from the CAMS global model at 3-hourly resolution, refreshed every 12 hours. The buffer waits one 3-hour model step to confirm AQI stays below the cutoff. https://open-meteo.com/en/docs/air-quality-api",
    },
    maxDelayHours: {
      value: OPM_STANDARD_DELAY_HOURS,
      unit: "hours",
      source: OPM_SOURCE,
      citation: `Policy choice: §I lists poor air quality among the disruptions the procedures cover, and §IV.B.3 Option 3a, Example 1 illustrates a 2-hour delayed arrival. Smoke rarely clears within a morning, so an event longer than 2 hours calls for telework or closure. ${OPM_URL}`,
    },
  },
  flood: {
    cutoffs: {
      warning: {
        value: "Severe",
        unit: "nws_severity",
        events: ["Flood Warning", "Flash Flood Warning"],
        posture: "unscheduled_telework",
        source: NWSI_10_922_SOURCE,
        citation: `§5: a Flash Flood Warning is issued "when flooding is imminent or likely" for events "which require immediate action to protect life and property". §7 and §9: a Flood Warning covers "high flow, overflow, or inundation" threatening life and property, over an area that "may be all or a portion of one or more counties". Flash Flood Warnings and most Flood Warnings on api.weather.gov carry CAP severity "Severe", which CAP v1.2 §3.2.2 defines as "Significant threat to life or property"; forecast-point Flood Warnings for minor flooding carry "Minor" and stay below this cutoff. A county-wide warning threatens the commute, not necessarily the building, so staff telework. ${NWSI_10_922_URL} ${CAP_V1_2_URL}`,
      },
      moderateFlood: {
        value: "moderate",
        unit: "nws_flood_category",
        posture: "unscheduled_telework",
        source: NWSM_10_950_SOURCE,
        citation: `§2.8.2 Moderate Flooding: "some inundation of structures and roads near stream, evacuations of people and/or transfer of property to higher elevations." §2.8: flood categories are defined "for each forecast point" because "the severity of flooding at a given stage is not necessarily the same at all locations", so the moderate stage is read at runtime from the facility gauge's NWPS record (flood.categories.moderate.stage). A gauge with no moderate stage never crosses this cutoff. Roads near the river flood, so staff telework. ${NWSM_10_950_URL} ${NWPS_GAUGE_URL}`,
      },
      majorFlood: {
        value: "major",
        unit: "nws_flood_category",
        posture: "full_closure",
        source: NWSM_10_950_SOURCE,
        citation: `§2.8.3 Major Flooding: "extensive inundation of structures and roads, significant evacuations of people and/or transfer of property to higher elevations." The major stage is read at runtime from the facility gauge's NWPS record (flood.categories.major.stage). Structures near the gauge may flood, so the facility closes. ${NWSM_10_950_URL} ${NWPS_GAUGE_URL}`,
      },
    },
    postHazardBufferMinutes: {
      value: NWPS_FORECAST_STEP_MINUTES,
      unit: "minutes",
      source:
        "Closure Call policy, with National Weather Service After a Flood safety guidance; no NWS or OPM standard sets a buffer after flooding ends",
      citation: `Policy choice: NWS warns that "when flood waters recede, the damage left behind can be devastating", including "decimated roadways", and that "the road could have collapsed". NWPS forecasts river stage in 6-hour steps, so the buffer waits one step after the stage falls below the cutoff to confirm the river keeps falling and to give crews time to inspect commute routes. ${NWS_AFTER_FLOOD_URL}`,
    },
    maxDelayHours: {
      value: OPM_STANDARD_DELAY_HOURS,
      unit: "hours",
      source: OPM_SOURCE,
      citation: `Policy choice: OPM sets no cap. §IV.C, Agency-Specific Announcements, names "localized flooding" as an emergency that lets agencies "close individual facilities on a localized, building-by-building basis", and §IV.B.3 Option 3a, Example 1 illustrates a 2-hour delayed arrival. River flooding lasts days rather than hours, so an event longer than 2 hours calls for telework or closure. ${OPM_URL}`,
    },
  },
} as const satisfies Record<Hazard, HazardThresholds>;
