import { Value } from "@sinclair/typebox/value";
import {
  makeNwpsClient,
  type NwpsClientShape,
  type NwpsGaugeId,
  NwpsGaugeIdSchema,
} from "./nwps";

const BASE_URL = "http://nwps.test";
const GAUGE_URL = `${BASE_URL}/gauges/KCDM7`;
const FORECAST_URL = `${GAUGE_URL}/stageflow/forecast`;

// Trimmed from the live KCDM7 responses of 2026-10-11.
const KCDM7_GAUGE_BODY =
  '{"lid":"KCDM7","name":"Missouri River at Kansas City","latitude":39.111722,"longitude":-94.588139,"status":{"observed":{"primary":14.94,"primaryUnit":"ft","secondary":71.4,"secondaryUnit":"kcfs","floodCategory":"no_flooding","validTime":"2026-10-11T00:30:00Z"},"forecast":{"primary":15,"primaryUnit":"ft","secondary":71.7,"secondaryUnit":"kcfs","floodCategory":"no_flooding","validTime":"2026-10-11T06:00:00Z"}},"flood":{"stageUnits":"ft","flowUnits":"cfs","categories":{"major":{"stage":49,"flow":-9999},"moderate":{"stage":35,"flow":-9999},"minor":{"stage":32,"flow":-9999},"action":{"stage":29,"flow":-9999}}}}';
const KCDM7_FORECAST_BODY =
  '{"issuedTime":"2026-10-10T14:11:00Z","primaryUnits":"ft","secondaryUnits":"kcfs","data":[{"validTime":"2026-10-11T06:00:00Z","primary":15.1,"secondary":72.4},{"validTime":"2026-10-11T12:00:00Z","primary":15,"secondary":71.7}]}';

function gaugeId(raw: string): NwpsGaugeId {
  if (!Value.Check(NwpsGaugeIdSchema, raw)) {
    throw new Error(`not an NWPS gauge id: ${raw}`);
  }
  return raw;
}

const KCDM7 = gaugeId("KCDM7");

/** A client whose requests are answered from a queue per URL, recording every URL requested. */
function nwpsClientFor(
  responses: Readonly<Record<string, readonly Response[]>>,
): { readonly client: NwpsClientShape; readonly urls: readonly string[] } {
  const urls: string[] = [];
  function fetch(url: URL): Promise<Response> {
    const asked = urls.filter((href) => href === url.href).length;
    urls.push(url.href);
    const next = responses[url.href]?.[asked];
    if (next === undefined) {
      return Promise.reject(new Error(`unexpected request to ${url.href}`));
    }
    return Promise.resolve(next);
  }
  return { client: makeNwpsClient(fetch, BASE_URL), urls };
}

export {
  FORECAST_URL,
  GAUGE_URL,
  KCDM7,
  KCDM7_FORECAST_BODY,
  KCDM7_GAUGE_BODY,
  nwpsClientFor,
};
