import { employeeStatusEvents } from "@hackmidwest/db";
import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { expect, it } from "vitest";
import { HTTP_CREATED, HTTP_NOT_FOUND } from "../../runtime";
import {
  appRunner,
  BACKUP_ID,
  DECIDED_AT,
  DECIDER_ID,
  FACILITY_ID,
  UNKNOWN_ID,
} from "./decision-test-fixtures";
import {
  AVERY_TELEWORK_ELIGIBLE,
  DELIA_ALREADY_TELEWORKING,
  HANA_ACCESSIBILITY_NEEDS,
  LATER,
  person,
  personnel,
} from "./personnel-test-fixtures";

const withApp = appRunner(createTestDatabaseWithDemoFacilities);

it("answers 404 for an unknown facility", async () => {
  await withApp(async ({ request }) => {
    const response = await request(`/api/facilities/${UNKNOWN_ID}/personnel`);

    expect(response.status).toBe(HTTP_NOT_FOUND);
    expect(await response.json()).toEqual({ message: "Facility not found" });
  });
});

it("with no decision, lists each person at their baseline with who may record a status", async () => {
  await withApp(async ({ request }) => {
    const body = await personnel(request);

    expect(body).toMatchObject({
      facilityId: FACILITY_ID,
      asOf: DECIDED_AT,
      decision: null,
      posture: { kind: "none" },
      recorders: [
        { id: DECIDER_ID, name: "Dana Whitfield" },
        { id: BACKUP_ID, name: "Marcus Oyelaran" },
      ],
    });
    expect(person(body, DELIA_ALREADY_TELEWORKING)).toMatchObject({
      baseline: { status: "teleworking" },
      effective: { kind: "teleworking", cause: { source: "baseline" } },
    });
    expect(person(body, HANA_ACCESSIBILITY_NEEDS)).toMatchObject({
      name: "Hana Kowalczyk",
      hasAccessibilityNeeds: true,
      effective: { kind: "working_onsite" },
    });
    expect(person(body, HANA_ACCESSIBILITY_NEEDS)).not.toHaveProperty(
      "accessibilityNeeds",
    );
  });
});

it("takes the latest event in effect as baseline and shows a future-dated one only as the latest event", async () => {
  await withApp(async ({ request }) => {
    await request(`/api/employees/${AVERY_TELEWORK_ELIGIBLE}/status`, {
      status: "teleworking",
      reportedById: DECIDER_ID,
    });
    const scheduled = await request(
      `/api/employees/${AVERY_TELEWORK_ELIGIBLE}/status`,
      {
        status: "not_working",
        note: "Leave starts this afternoon.",
        reportedById: DECIDER_ID,
        effectiveFrom: LATER,
      },
    );
    expect(scheduled.status).toBe(HTTP_CREATED);

    const avery = person(await personnel(request), AVERY_TELEWORK_ELIGIBLE);

    expect(avery).toMatchObject({
      baseline: { status: "teleworking" },
      latestEvent: { status: "not_working", effectiveFrom: LATER },
      effective: { kind: "teleworking" },
    });
  });
});

it("leaves an event reported after asOf out of latestEvent", async () => {
  await withApp(async ({ db, request }) => {
    await db.insert(employeeStatusEvents).values({
      employeeId: AVERY_TELEWORK_ELIGIBLE,
      status: "teleworking",
      reportedById: DECIDER_ID,
      reportedAt: LATER,
      effectiveFrom: LATER,
    });

    const avery = person(await personnel(request), AVERY_TELEWORK_ELIGIBLE);

    expect(avery).toMatchObject({
      baseline: { status: "working_onsite" },
      latestEvent: { reportedAt: "2026-10-01T12:00:00.000Z" },
    });
  });
});
