import type { Recommendation } from "../src/features/closure/decision-api";

/** A live Kansas City recommendation captured from the API, with the forecast cut to one period and source links shortened. */
export const KANSAS_CITY_RECOMMENDATION: Recommendation = {
  id: 1,
  facilityId: 1,
  evaluatedAt: "2026-10-11T08:33:32.095Z",
  asOf: "2026-10-11T08:33:32.095Z",
  posture: "normal",
  confidence: "high",
  decideBy: "2026-10-11T10:00:00.000Z",
  snapshot: {
    input: {
      now: "2026-10-11T08:33:32.095Z",
      facility: {
        timezone: "America/Chicago",
        opensAt: "07:30",
        closesAt: "16:30",
        arrivalWindowStart: "06:30",
        arrivalWindowEnd: "09:00",
        typicalCommuteMinutes: 35,
        roadClass: "superCommuter",
        decisionDeadline: "05:00",
        hazards: ["winter", "wind", "airQuality", "flood"],
      },
      alerts: {
        asOf: "2026-10-11T08:33:32.095Z",
        items: [],
      },
      readings: [
        {
          source: "nws",
          observedAt: "2026-10-11T08:20:00+00:00",
          metric: "temperature",
          value: 21,
          unit: "degC",
          rawRef: "https://source.test/rawRef",
        },
        {
          source: "nws",
          observedAt: "2026-10-11T08:20:00+00:00",
          metric: "windSpeed",
          value: 14.832,
          unit: "km/h",
          rawRef: "https://source.test/rawRef",
        },
        {
          source: "nws",
          observedAt: "2026-10-11T08:20:00+00:00",
          metric: "visibility",
          value: 16_093.44,
          unit: "m",
          rawRef: "https://source.test/rawRef",
        },
        {
          source: "open-meteo",
          observedAt: "2026-10-11T08:00:00.000Z",
          metric: "aqi",
          value: 40,
          unit: "AQI",
          rawRef: "https://source.test/rawRef",
        },
      ],
      forecast: {
        asOf: "2026-10-11T07:31:59+00:00",
        rawRef: "https://source.test/rawRef",
        periods: [
          {
            startTime: "2026-10-11T02:00:00-05:00",
            endTime: "2026-10-11T03:00:00-05:00",
            isDaytime: false,
            temperature: 72,
            temperatureUnit: "F",
            windSpeed: "6 mph",
            windDirection: "SW",
            shortForecast: "Clear",
            probabilityOfPrecipitation: 0,
          },
        ],
      },
      gauge: {
        rawRef: "https://source.test/rawRef",
        asOf: "2026-10-11T08:33:32.095Z",
        floodStagesFt: {
          action: 29,
          minor: 32,
          moderate: 35,
          major: 49,
        },
        observed: {
          stageFt: 14.83,
          validTime: "2026-10-11T06:30:00Z",
        },
        forecast: [
          {
            stageFt: 15.1,
            validTime: "2026-10-10T18:00:00Z",
          },
          {
            stageFt: 15.1,
            validTime: "2026-10-11T00:00:00Z",
          },
          {
            stageFt: 15,
            validTime: "2026-10-11T06:00:00Z",
          },
          {
            stageFt: 14.9,
            validTime: "2026-10-11T12:00:00Z",
          },
          {
            stageFt: 14.8,
            validTime: "2026-10-11T18:00:00Z",
          },
          {
            stageFt: 14.7,
            validTime: "2026-10-12T00:00:00Z",
          },
          {
            stageFt: 14.6,
            validTime: "2026-10-12T06:00:00Z",
          },
          {
            stageFt: 14.5,
            validTime: "2026-10-12T12:00:00Z",
          },
          {
            stageFt: 14.5,
            validTime: "2026-10-12T18:00:00Z",
          },
          {
            stageFt: 14.4,
            validTime: "2026-10-13T00:00:00Z",
          },
          {
            stageFt: 14.3,
            validTime: "2026-10-13T06:00:00Z",
          },
          {
            stageFt: 14.2,
            validTime: "2026-10-13T12:00:00Z",
          },
          {
            stageFt: 14.1,
            validTime: "2026-10-13T18:00:00Z",
          },
          {
            stageFt: 14,
            validTime: "2026-10-14T00:00:00Z",
          },
          {
            stageFt: 13.9,
            validTime: "2026-10-14T06:00:00Z",
          },
          {
            stageFt: 13.8,
            validTime: "2026-10-14T12:00:00Z",
          },
          {
            stageFt: 13.7,
            validTime: "2026-10-14T18:00:00Z",
          },
          {
            stageFt: 13.6,
            validTime: "2026-10-15T00:00:00Z",
          },
          {
            stageFt: 13.5,
            validTime: "2026-10-15T06:00:00Z",
          },
          {
            stageFt: 13.3,
            validTime: "2026-10-15T12:00:00Z",
          },
          {
            stageFt: 13.2,
            validTime: "2026-10-15T18:00:00Z",
          },
          {
            stageFt: 13,
            validTime: "2026-10-16T00:00:00Z",
          },
          {
            stageFt: 12.9,
            validTime: "2026-10-16T06:00:00Z",
          },
          {
            stageFt: 12.7,
            validTime: "2026-10-16T12:00:00Z",
          },
          {
            stageFt: 12.6,
            validTime: "2026-10-16T18:00:00Z",
          },
          {
            stageFt: 12.5,
            validTime: "2026-10-17T00:00:00Z",
          },
          {
            stageFt: 12.4,
            validTime: "2026-10-17T06:00:00Z",
          },
          {
            stageFt: 12.3,
            validTime: "2026-10-17T12:00:00Z",
          },
        ],
      },
    },
    output: {
      asOf: "2026-10-11T08:33:32.095Z",
      facilityDate: "2026-10-11",
      status: {
        posture: "normal",
      },
      nextDay: null,
      decideBy: {
        at: "2026-10-11T10:00:00.000Z",
        local: "05:00",
        pastDeadline: false,
      },
      confidence: {
        level: "high",
        reasons: [],
      },
      findings: [],
      sensitivity: [],
      rationale:
        "No monitored hazard crosses a cutoff, so recommend normal operations on 2026-10-11. Decide by 05:00. Confidence is high.",
    },
  },
  contentHash: "fixture",
  mode: "live",
  timeline: [
    {
      event: "input",
      at: "2026-10-11T06:30:00Z",
      input: "gauge",
    },
    {
      event: "input",
      at: "2026-10-11T07:31:59+00:00",
      input: "forecast",
    },
    {
      event: "input",
      at: "2026-10-11T08:00:00.000Z",
      input: "airQuality",
    },
    {
      event: "input",
      at: "2026-10-11T08:20:00+00:00",
      input: "observations",
    },
    {
      event: "evaluated",
      at: "2026-10-11T08:33:32.095Z",
    },
    {
      event: "input",
      at: "2026-10-11T08:33:32.095Z",
      input: "alerts",
    },
    {
      event: "decideBy",
      at: "2026-10-11T10:00:00.000Z",
    },
  ],
};
