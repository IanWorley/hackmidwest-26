import { Value } from "@sinclair/typebox/value";
import { Effect } from "effect";
import {
  type NwpsClientShape,
  type NwpsError,
  type NwpsGaugeId,
  NwpsGaugeIdSchema,
  type RiverGauge,
} from "../../clients/nwps";
import type { GeoPoint } from "../../clients/nws-model";
import { NwpsClient, NwsClient, OpenMeteoClient } from "../../runtime";
import type { EngineInput } from "./engine-input";
import type { Facility } from "./facilities";
import { airQualityReadings, observationReadings } from "./readings";

// A CHECK constraint holds the column to the NWPS id format, so a mismatch is a defect.
function gaugeIdOf({ nwpsGaugeId }: Facility): NwpsGaugeId | null {
  if (nwpsGaugeId === null) {
    return null;
  }
  if (!Value.Check(NwpsGaugeIdSchema, nwpsGaugeId)) {
    throw new TypeError(`Stored gauge id ${nwpsGaugeId} is not an NWPS id`);
  }
  return nwpsGaugeId;
}

function pullGauge(
  nwps: NwpsClientShape,
  gaugeId: NwpsGaugeId | null,
): Effect.Effect<RiverGauge | null, NwpsError> {
  if (gaugeId === null) {
    return Effect.succeed(null);
  }
  return nwps.gauge(gaugeId);
}

function gaugeInput(gauge: RiverGauge, asOf: string): EngineInput["gauge"] {
  return {
    rawRef: gauge.rawRef,
    asOf,
    floodStagesFt: gauge.floodStagesFt,
    observed: gauge.observed ?? null,
    forecast: [...gauge.forecast],
  };
}

const pullInput = Effect.fn("pullInput")(function* (
  facility: Facility,
  now: string,
  pulledAt: string,
) {
  const nws = yield* NwsClient;
  const nwps = yield* NwpsClient;
  const openMeteo = yield* OpenMeteoClient;
  const point: GeoPoint = { lat: facility.latitude, lon: facility.longitude };
  const pulled = yield* Effect.all(
    {
      alerts: nws.activeAlerts(point),
      forecast: nws.hourlyForecast(point),
      observation: nws.latestObservation(point),
      airQuality: openMeteo.currentAqi(point),
      gauge: pullGauge(nwps, gaugeIdOf(facility)),
    },
    { concurrency: "unbounded" },
  );
  const input: EngineInput = {
    now,
    facility: {
      timezone: facility.timezone,
      opensAt: facility.opensAt,
      closesAt: facility.closesAt,
      arrivalWindowStart: facility.arrivalWindowStart,
      arrivalWindowEnd: facility.arrivalWindowEnd,
      typicalCommuteMinutes: facility.typicalCommuteMinutes,
      roadClass: facility.roadClass,
      decisionDeadline: facility.decisionDeadline,
      hazards: facility.hazards,
    },
    alerts: { asOf: pulledAt, items: pulled.alerts },
    readings: [
      ...observationReadings(pulled.observation),
      ...airQualityReadings(pulled.airQuality),
    ],
    // Staleness counts from when NWS issued the forecast, not when it was fetched.
    forecast: {
      asOf: pulled.forecast.updateTime,
      rawRef: pulled.forecast.rawRef,
      periods: pulled.forecast.periods,
    },
    gauge: pulled.gauge && gaugeInput(pulled.gauge, pulledAt),
  };
  return input;
});

export { pullInput };
