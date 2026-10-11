import { expect, it } from "vitest";
import { airQualityReadings, observationReadings } from "./readings";

const OBSERVATION_URL =
  "https://api.weather.gov/stations/KMKC/observations/2026-10-11T00:30:00+00:00";

it("normalizes known units and skips null values and unknown unit codes", () => {
  const readings = observationReadings({
    stationId: "KMKC",
    timestamp: "2026-10-11T00:30:00+00:00",
    rawRef: OBSERVATION_URL,
    temperature: { value: 28, unitCode: "wmoUnit:degC" },
    windSpeed: { value: 16.668, unitCode: "wmoUnit:km_h-1" },
    windGust: { value: null, unitCode: "wmoUnit:km_h-1" },
    visibility: { value: 10, unitCode: "wmoUnit:mi" },
  });

  expect(readings).toEqual([
    {
      source: "nws",
      observedAt: "2026-10-11T00:30:00+00:00",
      metric: "temperature",
      value: 28,
      unit: "degC",
      rawRef: OBSERVATION_URL,
    },
    {
      source: "nws",
      observedAt: "2026-10-11T00:30:00+00:00",
      metric: "windSpeed",
      value: 16.668,
      unit: "km/h",
      rawRef: OBSERVATION_URL,
    },
  ]);
});

it("turns each AirNow pollutant observation into an AQI reading", () => {
  const readings = airQualityReadings([
    {
      parameter: "PM2.5",
      aqi: 158,
      category: "Unhealthy",
      reportingArea: "Kansas City",
      observedAt: "2026-10-11T00:00:00.000Z",
      rawRef: "airnow:Kansas City:PM2.5:2026-10-11T00:00:00.000Z",
    },
  ]);

  expect(readings).toEqual([
    {
      source: "airnow",
      observedAt: "2026-10-11T00:00:00.000Z",
      metric: "aqi",
      value: 158,
      unit: "AQI",
      rawRef: "airnow:Kansas City:PM2.5:2026-10-11T00:00:00.000Z",
    },
  ]);
});
