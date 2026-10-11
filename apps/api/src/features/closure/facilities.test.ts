import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { makeNwpsClient } from "../../clients/nwps";
import { makeNwsClient } from "../../clients/nws";
import { makeOpenMeteoClient } from "../../clients/open-meteo";
import { createApiRuntime, HTTP_NOT_FOUND, HTTP_OK } from "../../runtime";
import { FACILITIES_PATH } from "./facilities";

const REQUEST_ORIGIN = "http://api.test";
const WEB_ORIGIN = "http://web.test";
const UNKNOWN_FACILITY_ID = 999;
// Both unknown: the first is a 16-digit safe integer, the second rounds to another id.
const LARGE_FACILITY_IDS = ["1000000000000000", "9007199254740993"] as const;
const HTTP_UNPROCESSABLE = 422;
// Each one coerces to a number, and the first three would alias facility 1.
const MALFORMED_FACILITY_IDS = ["0x1", "1e0", "01", "0"] as const;

async function getFromSeededApp(path: string): Promise<Response> {
  const store = await createTestDatabaseWithDemoFacilities();
  const runtime = createApiRuntime(store.db, {
    nws: makeNwsClient({ userAgent: "facilities test, never sent" }),
    openMeteo: makeOpenMeteoClient(),
    nwps: makeNwpsClient(),
  });
  try {
    const app = createApp({
      runRequest: runtime.runRequest,
      webOrigin: WEB_ORIGIN,
    });
    return await app.handle(new Request(new URL(path, REQUEST_ORIGIN)));
  } finally {
    try {
      await runtime.dispose();
    } finally {
      store.close();
    }
  }
}

describe(`GET ${FACILITIES_PATH}`, () => {
  it("lists facilities by name with each one's hazards", async () => {
    const response = await getFromSeededApp(FACILITIES_PATH);

    expect(response.status).toBe(HTTP_OK);
    const body: { name: string; hazards: string[] }[] = await response.json();
    expect(body.map(({ name, hazards }) => ({ name, hazards }))).toEqual([
      { name: "Fargo Service Center", hazards: ["winter", "wind"] },
      {
        name: "Kansas City Area Service Center",
        hazards: ["winter", "wind", "airQuality", "flood"],
      },
      { name: "Lafayette Service Center", hazards: ["wind"] },
      { name: "Yakima Service Center", hazards: ["winter", "airQuality"] },
    ]);
  });
});

describe(`GET ${FACILITIES_PATH}/:id`, () => {
  it("returns the facility with its hazards", async () => {
    const response = await getFromSeededApp(`${FACILITIES_PATH}/1`);

    expect(response.status).toBe(HTTP_OK);
    expect(await response.json()).toEqual({
      id: 1,
      name: "Kansas City Area Service Center",
      latitude: 39.0997,
      longitude: -94.5786,
      nwsZone: "MOZ037",
      timezone: "America/Chicago",
      nwpsGaugeId: "KCDM7",
      opensAt: "07:30",
      closesAt: "16:30",
      arrivalWindowStart: "06:30",
      arrivalWindowEnd: "09:00",
      departureWindowStart: "15:30",
      departureWindowEnd: "18:00",
      typicalCommuteMinutes: 35,
      decisionDeadline: "05:00",
      notificationLeadMinutes: 60,
      decisionMakerId: 1,
      backupDecisionMakerId: 2,
      roadClass: "superCommuter",
      hazards: ["winter", "wind", "airQuality", "flood"],
    });
  });

  it("returns 404 for an id no facility has", async () => {
    const response = await getFromSeededApp(
      `${FACILITIES_PATH}/${UNKNOWN_FACILITY_ID}`,
    );

    expect(response.status).toBe(HTTP_NOT_FOUND);
    expect(await response.json()).toEqual({ message: "Facility not found" });
  });

  it.each(LARGE_FACILITY_IDS)("returns 404 for large id %s", async (id) => {
    const response = await getFromSeededApp(`${FACILITIES_PATH}/${id}`);

    expect(response.status).toBe(HTTP_NOT_FOUND);
  });

  it.each(MALFORMED_FACILITY_IDS)("rejects facility id %j", async (id) => {
    const response = await getFromSeededApp(`${FACILITIES_PATH}/${id}`);

    expect(response.status).toBe(HTTP_UNPROCESSABLE);
  });
});

describe(`GET ${FACILITIES_PATH}/:id/buildings`, () => {
  it("lists the facility's buildings with their employees by name", async () => {
    const response = await getFromSeededApp(`${FACILITIES_PATH}/2/buildings`);

    expect(response.status).toBe(HTTP_OK);
    expect(await response.json()).toEqual([
      {
        id: 4,
        name: "Main Office",
        employees: [
          { id: 21, name: "Uma Sorensen" },
          { id: 22, name: "Walt Hagen" },
          { id: 23, name: "Xenia Larsen" },
        ],
      },
    ]);
  });

  it("returns 404 for an id no facility has", async () => {
    const response = await getFromSeededApp(
      `${FACILITIES_PATH}/${UNKNOWN_FACILITY_ID}/buildings`,
    );

    expect(response.status).toBe(HTTP_NOT_FOUND);
    expect(await response.json()).toEqual({ message: "Facility not found" });
  });
});

describe(`GET ${FACILITIES_PATH}/:id/recorders`, () => {
  it("returns the facility's decision maker, then its backup", async () => {
    const response = await getFromSeededApp(`${FACILITIES_PATH}/1/recorders`);

    expect(response.status).toBe(HTTP_OK);
    expect(await response.json()).toEqual([
      {
        id: 1,
        name: "Dana Whitfield",
        role: "County Executive Director",
      },
      {
        id: 2,
        name: "Marcus Oyelaran",
        role: "State Administrative Officer",
      },
    ]);
  });

  it("returns 404 for an id no facility has", async () => {
    const response = await getFromSeededApp(
      `${FACILITIES_PATH}/${UNKNOWN_FACILITY_ID}/recorders`,
    );

    expect(response.status).toBe(HTTP_NOT_FOUND);
    expect(await response.json()).toEqual({ message: "Facility not found" });
  });
});
