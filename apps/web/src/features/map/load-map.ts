import { api } from "@/lib/api";

/** Routes receive successful domain data; Eden error envelopes stop at this boundary. */
export async function loadMap({ signal }: { signal: AbortSignal }) {
  const result = await api.api.map.get({ fetch: { signal } });
  if (result.error !== null) {
    throw new Error("Unable to load the map", { cause: result.error.value });
  }
  return result.data;
}

export type MapData = Awaited<ReturnType<typeof loadMap>>;
export type MapFacility = MapData["facilities"][number];
export type Standing = MapFacility["standing"];
export type StandingPosture = Standing["posture"];
export type EvaluatedStanding = Exclude<Standing, { posture: "not_evaluated" }>;
export type Posture = EvaluatedStanding["posture"];
export type Decision = NonNullable<EvaluatedStanding["currentDecision"]>;
export type DecisionAction = Decision["action"];
export type Aqi = NonNullable<MapFacility["aqi"]>;
export type AlertCollection = NonNullable<MapData["alerts"]>;
export type AlertFeature = AlertCollection["features"][number];
export type AlertSeverity = AlertFeature["properties"]["severity"];
