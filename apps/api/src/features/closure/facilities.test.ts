import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { makeNwsClient } from "../../clients/nws";
import { makeOpenMeteoClient } from "../../clients/open-meteo";
import { createApiRuntime, HTTP_NOT_FOUND, HTTP_OK } from "../../runtime";
import { FACILITIES_PATH } from "./facilities";

const REQUEST_ORIGIN = "http://api.test";
const WEB_ORIGIN = "http://web.test";
const UNKNOWN_FACILITY_ID = 999;

async function getFromSeededApp(path: string): Promise<Response> {
  const store = await createTestDatabaseWithDemoFacilities();
  const runtime = createApiRuntime(store.db, {
    nws: makeNwsClient({ userAgent: "facilities test, never sent" }),
    openMeteo: makeOpenMeteoClient(),
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
        hazards: ["winter", "wind", "airQuality"],
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
      hazards: ["winter", "wind", "airQuality"],
    });
  });

  it("returns 404 for an id no facility has", async () => {
    const response = await getFromSeededApp(
      `${FACILITIES_PATH}/${UNKNOWN_FACILITY_ID}`,
    );

    expect(response.status).toBe(HTTP_NOT_FOUND);
    expect(await response.json()).toEqual({ message: "Facility not found" });
  });
});
