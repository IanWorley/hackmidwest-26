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

const AIR_QUALITY_URL =
  "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=39.1&longitude=-94.58&current=us_aqi&timeformat=unixtime";

it("turns an Open-Meteo AQI observation into an AQI reading", () => {
  const readings = airQualityReadings({
    aqi: 158,
    observedAt: "2026-10-11T01:00:00.000Z",
    rawRef: AIR_QUALITY_URL,
  });

  expect(readings).toEqual([
    {
      source: "open-meteo",
      observedAt: "2026-10-11T01:00:00.000Z",
      metric: "aqi",
      value: 158,
      unit: "AQI",
      rawRef: AIR_QUALITY_URL,
    },
  ]);
});
