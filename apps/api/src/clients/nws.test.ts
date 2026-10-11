import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { makeNwsClient, type NwsClientShape } from "./nws";
import { hazardWindow } from "./nws-model";

const BASE_URL = "http://nws.test";
const USER_AGENT = "hackmidwest-26 test (ops@example.com)";
const KANSAS_CITY = { lat: 39.099_712, lon: -94.578_561 };
const HTTP_NOT_FOUND = 404;
const HTTP_SERVICE_UNAVAILABLE = 503;

const ALERT = {
  id: "urn:oid:alert-2",
  event: "Winter Storm Warning",
  headline: "Winter Storm Warning until Saturday",
  severity: "Severe",
  certainty: "Likely",
  urgency: "Expected",
  messageType: "Update",
  references: [{ identifier: "urn:oid:alert-1", sender: "w-nws" }],
  effective: "2026-01-09T09:00:00-06:00",
  onset: "2026-01-09T18:00:00-06:00",
  ends: "2026-01-10T12:00:00-06:00",
  expires: "2026-01-10T06:00:00-06:00",
};

interface SentRequest {
  readonly url: string;
  readonly userAgent: string | null;
  readonly accept: string | null;
}

/** A client whose requests are answered from `responses` in order and recorded in `sent`. */
function clientFor(responses: Response[]): {
  readonly client: NwsClientShape;
  readonly sent: SentRequest[];
} {
  const sent: SentRequest[] = [];
  function fetch(url: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    sent.push({
      url,
      userAgent: headers.get("User-Agent"),
      accept: headers.get("Accept"),
    });
    const response = responses.shift();
    if (response === undefined) {
      return Promise.reject(new Error(`unexpected request to ${url}`));
    }
    return Promise.resolve(response);
  }
  return {
    client: makeNwsClient({ userAgent: USER_AGENT, fetch, baseUrl: BASE_URL }),
    sent,
  };
}

function alertsResponse(properties: object): Response {
  return Response.json({ features: [{ properties }] });
}

describe("hazardWindow", () => {
  it("runs from onset to ends when NWS gives both", () => {
    expect(hazardWindow(ALERT)).toEqual({
      start: "2026-01-09T18:00:00-06:00",
      end: "2026-01-10T12:00:00-06:00",
      endBasis: "ends",
    });
  });

  it("falls back to expires, marked as such, when ends is null", () => {
    expect(hazardWindow({ ...ALERT, ends: null })).toEqual({
      start: "2026-01-09T18:00:00-06:00",
      end: "2026-01-10T06:00:00-06:00",
      endBasis: "expires",
    });
  });

  it("starts at effective when onset is null", () => {
    expect(hazardWindow({ ...ALERT, onset: null }).start).toBe(
      "2026-01-09T09:00:00-06:00",
    );
  });
});

it("sends rounded coordinates with the User-Agent and GeoJSON Accept headers", async () => {
  const { client, sent } = clientFor([Response.json({ features: [] })]);

  await Effect.runPromise(client.activeAlerts(KANSAS_CITY));

  expect(sent).toEqual([
    {
      url: "http://nws.test/alerts/active?point=39.0997,-94.5786",
      userAgent: "hackmidwest-26 test (ops@example.com)",
      accept: "application/geo+json",
    },
  ]);
});

it("parses alerts, carrying reference ids and the hazard window", async () => {
  const { client } = clientFor([alertsResponse(ALERT)]);

  const alerts = await Effect.runPromise(client.activeAlerts(KANSAS_CITY));

  expect(alerts).toEqual([
    {
      id: "urn:oid:alert-2",
      event: "Winter Storm Warning",
      headline: "Winter Storm Warning until Saturday",
      severity: "Severe",
      certainty: "Likely",
      urgency: "Expected",
      messageType: "Update",
      references: ["urn:oid:alert-1"],
      hazardWindow: {
        start: "2026-01-09T18:00:00-06:00",
        end: "2026-01-10T12:00:00-06:00",
        endBasis: "ends",
      },
    },
  ]);
});

it("fails with a schema error when a payload lacks a required field", async () => {
  const { event: _omitted, ...alertWithoutEvent } = ALERT;
  const { client } = clientFor([alertsResponse(alertWithoutEvent)]);

  const error = await Effect.runPromise(
    Effect.flip(client.activeAlerts(KANSAS_CITY)),
  );

  expect(error.reason).toEqual({
    kind: "schema",
    errors: [
      "/features/0/properties/event Expected required property",
      "/features/0/properties/event Expected string",
    ],
  });
});

it("retries a 503 and returns the next successful response", async () => {
  const { client, sent } = clientFor([
    new Response(null, { status: HTTP_SERVICE_UNAVAILABLE }),
    alertsResponse(ALERT),
  ]);

  const alerts = await Effect.runPromise(client.activeAlerts(KANSAS_CITY));

  expect([sent.length, alerts.map(({ id }) => id)]).toEqual([
    2,
    ["urn:oid:alert-2"],
  ]);
});

it("fails a 404 with its status after one request", async () => {
  const { client, sent } = clientFor([
    new Response(null, { status: HTTP_NOT_FOUND }),
  ]);

  const error = await Effect.runPromise(
    Effect.flip(client.forecast(KANSAS_CITY)),
  );

  expect([sent.length, error.reason, error.message]).toEqual([
    1,
    { kind: "status", status: 404 },
    "NWS request failed (HTTP 404): http://nws.test/points/39.0997,-94.5786",
  ]);
});
