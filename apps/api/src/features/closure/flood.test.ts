import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  FLOOD_CATEGORIES,
  type NwpsClientShape,
  type RiverGauge,
} from "../../clients/nwps";
import {
  FORECAST_URL,
  GAUGE_URL,
  KCDM7,
  KCDM7_FORECAST_BODY,
  KCDM7_GAUGE_BODY,
  nwpsClientFor,
} from "../../clients/nwps-test-client";
import type { NwsClientShape } from "../../clients/nws";
import type { NwsAlert } from "../../clients/nws-model";
import { NwpsClient, NwsClient } from "../../runtime";
import {
  crossedFloodCutoffs,
  gaugeCrossing,
  pullFloodSignals,
  withCurrentStages,
} from "./flood";

const KANSAS_CITY = { lat: 39.0997, lon: -94.5786 };
// Above KCDM7's 35 ft moderate stage, below its 49 ft major stage.
const MODERATE_FLOOD_BODY = KCDM7_GAUGE_BODY.replace(
  '"primary":14.94',
  '"primary":36.2',
);
const MISSING_MODERATE_STAGE_BODY = MODERATE_FLOOD_BODY.replace(
  '"moderate":{"stage":35',
  '"moderate":{"stage":-9999',
);

// KCDM7_GAUGE_BODY's observed validTime.
const OBSERVED_AT = "2026-10-11T00:30:00Z";
const ONE_HOUR_MS = 3_600_000;
const ONE_DAY_MS = 86_400_000;

function alert(event: string, severity: NwsAlert["severity"]): NwsAlert {
  return {
    id: `urn:oid:${event}`,
    event,
    headline: null,
    severity,
    certainty: "Likely",
    urgency: "Expected",
    messageType: "Alert",
    references: [],
    hazardWindow: {
      start: "2026-10-11T06:00:00-05:00",
      end: "2026-10-12T06:00:00-05:00",
      endBasis: "expires",
    },
  };
}

async function parsedGauge(gaugeBody: string): Promise<RiverGauge> {
  const { client } = nwpsClientFor({
    [GAUGE_URL]: [new Response(gaugeBody)],
    [FORECAST_URL]: [new Response(KCDM7_FORECAST_BODY)],
  });
  return await Effect.runPromise(client.gauge(KCDM7));
}

describe("crossedFloodCutoffs", () => {
  it("never crosses a cutoff whose NWPS stage is the -9999 missing value", async () => {
    const missing = await parsedGauge(MISSING_MODERATE_STAGE_BODY);
    const present = await parsedGauge(MODERATE_FLOOD_BODY);

    expect({
      missing: crossedFloodCutoffs({ alerts: [], gauge: missing }),
      present: crossedFloodCutoffs({ alerts: [], gauge: present }),
    }).toEqual({
      missing: { warning: false, moderateFlood: false, majorFlood: false },
      present: { warning: false, moderateFlood: true, majorFlood: false },
    });
  });
});

describe("withCurrentStages", () => {
  it("stops a gauge that quit reporting above moderate stage from crossing it", async () => {
    const gauge = await parsedGauge(MODERATE_FLOOD_BODY);
    const stale = { ...gauge, forecast: [] };
    const observedAtMs = Date.parse(OBSERVED_AT);

    expect({
      fresh: crossedFloodCutoffs({
        alerts: [],
        gauge: withCurrentStages(stale, observedAtMs + ONE_HOUR_MS),
      }).moderateFlood,
      stale: crossedFloodCutoffs({
        alerts: [],
        gauge: withCurrentStages(stale, observedAtMs + ONE_DAY_MS),
      }).moderateFlood,
    }).toEqual({ fresh: true, stale: false });
  });
});

describe("gaugeCrossing", () => {
  it("spans from the first stage at or above a category to the first point back below it", () => {
    const gauge: RiverGauge = {
      lid: KCDM7,
      name: "Missouri River at Kansas City",
      rawRef: GAUGE_URL,
      floodStagesFt: { action: 29, minor: 32, moderate: 35, major: 49 },
      observed: { stageFt: 30, validTime: "2026-10-11T00:30:00Z" },
      forecast: [
        { stageFt: 50, validTime: "2026-10-10T18:00:00Z" },
        { stageFt: 33, validTime: "2026-10-11T06:00:00Z" },
        { stageFt: 36, validTime: "2026-10-11T12:00:00Z" },
        { stageFt: 34, validTime: "2026-10-11T18:00:00Z" },
        { stageFt: 31, validTime: "2026-10-12T00:00:00Z" },
      ],
    };

    expect(
      Object.fromEntries(
        FLOOD_CATEGORIES.map((category) => [
          category,
          gaugeCrossing(gauge, category),
        ]),
      ),
    ).toEqual({
      action: { start: "2026-10-11T00:30:00Z", end: undefined },
      minor: { start: "2026-10-11T06:00:00Z", end: "2026-10-12T00:00:00Z" },
      moderate: {
        start: "2026-10-11T12:00:00Z",
        end: "2026-10-11T18:00:00Z",
      },
      major: undefined,
    });
  });
});

describe("pullFloodSignals", () => {
  it("applies flood alerts to a facility with no gauge without calling NWPS", async () => {
    const floodWarning = alert("Flood Warning", "Severe");
    const nws: NwsClientShape = {
      activeAlerts: () =>
        Effect.succeed([floodWarning, alert("Wind Advisory", "Moderate")]),
      forecast: () => Effect.die("unused"),
      hourlyForecast: () => Effect.die("unused"),
      latestObservation: () => Effect.die("unused"),
    };
    const nwps: NwpsClientShape = {
      gauge: () => Effect.die("a facility without a gauge called NWPS"),
    };

    const signals = await Effect.runPromise(
      pullFloodSignals(KANSAS_CITY, undefined).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(NwsClient, nws),
            Layer.succeed(NwpsClient, nwps),
          ),
        ),
      ),
    );

    expect({ signals, crossed: crossedFloodCutoffs(signals) }).toEqual({
      signals: { alerts: [floodWarning], gauge: undefined },
      crossed: { warning: true, moderateFlood: false, majorFlood: false },
    });
  });
});
