import { employeeStatusEvents, notificationDispatches } from "@hackmidwest/db";
import { KANSAS_CITY } from "@hackmidwest/db/demo-facilities";
import {
  createTestDatabaseWithDemoFacilities,
  DEMO_ROSTER_CASES,
} from "@hackmidwest/db/testing";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HTTP_NOT_FOUND, HTTP_OK } from "../../runtime";
import type { NotificationPreview } from "./notification-preview-schema";
import {
  AS_OF,
  CLOCK,
  EVALUATE_PATH,
  type TestApp,
  UNKNOWN_ID,
  withStormAppOn,
} from "./recommendation-test-app";
import { RECOMMENDATIONS_PATH } from "./recommendations";

type StatusEventRow = typeof employeeStatusEvents.$inferInsert;

const PREVIEW_PATH = `${RECOMMENDATIONS_PATH}/1/notifications/preview`;
// The seeded status events date from October 2026, after the storm's January
// clock, so this restates two standing statuses before it.
const STATUS_REPORTED_AT = "2026-01-13T15:00:00.000Z";

function withApp(run: (app: TestApp) => Promise<void>): Promise<void> {
  return withStormAppOn(createTestDatabaseWithDemoFacilities, run);
}

function restatedStatus(
  employeeId: number,
  { status, note }: Pick<StatusEventRow, "status" | "note">,
): StatusEventRow {
  return {
    employeeId,
    status,
    note,
    reportedById: KANSAS_CITY.decisionMakerId,
    reportedAt: STATUS_REPORTED_AT,
    effectiveFrom: STATUS_REPORTED_AT,
  };
}

function excludedAs(
  exclusion: NotificationPreview["exclusions"][number],
): [string, string, string] {
  if (exclusion.kind === "unmatched") {
    const { entry, reason } = exclusion.line;
    return [entry.listedName, exclusion.kind, reason];
  }
  const { employee, reason } = exclusion.line;
  return [employee.name, exclusion.kind, reason];
}

async function previewAfterEvaluating({
  get,
  post,
}: TestApp): Promise<NotificationPreview> {
  await post(EVALUATE_PATH, { asOf: AS_OF });
  const response = await get(PREVIEW_PATH);
  return response.json();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(CLOCK) });
});

afterEach(() => {
  vi.useRealTimers();
});

it(`GET ${PREVIEW_PATH} tells the seeded Kansas City roster about the recommended full closure`, async () => {
  await withApp(async (app) => {
    await app.db.insert(employeeStatusEvents).values([
      restatedStatus(DEMO_ROSTER_CASES.alreadyTeleworkingEmployeeId, {
        status: "teleworking",
        note: null,
      }),
      restatedStatus(DEMO_ROSTER_CASES.onLeaveEmployeeId, {
        status: "not_working",
        note: "On annual leave.",
      }),
    ]);

    const { recipients, exclusions } = await previewAfterEvaluating(app);

    expect({
      recipients: recipients.map(({ employee, status, delivery }) => [
        employee.name,
        status.effective.kind,
        delivery.channel,
      ]),
      exclusions: exclusions.map(excludedAs),
    }).toEqual({
      recipients: [
        ["Avery Calloway", "teleworking", "email"],
        ["Bianca Ferraro", "report_required", "email"],
        ["Caleb Mendoza", "report_required", "sms"],
        ["Elliot Brandt", "dismissed", "email"],
        ["Farah Haddad", "teleworking", "email"],
        ["Hana Kowalczyk", "teleworking", "email"],
        ["Isaac Thorne", "dismissed", "email"],
        ["Joelle Baptiste", "teleworking", "email"],
        ["Kenji Watanabe", "teleworking", "sms"],
        ["Lena Marchetti", "teleworking", "email"],
        ["Mateo Alvarez", "teleworking", "email"],
        ["Nadia Petrov", "teleworking", "email"],
        ["Owen Gallagher", "teleworking", "email"],
        ["Paloma Reyes", "teleworking", "email"],
        ["Quinn Hartley", "dismissed", "email"],
        ["Rosa Delgado", "teleworking", "email"],
        ["Silas Montgomery", "teleworking", "email"],
        ["Tessa Nguyen", "teleworking", "email"],
      ],
      exclusions: [
        ["Delia Okafor", "skipped", "already_teleworking"],
        ["Gideon Marsh", "skipped", "not_working"],
        ["Victor Lindgren", "unmatched", "not_in_hr"],
      ],
    });
  });
});

it(`GET ${PREVIEW_PATH} frames the notices with the recommendation's instant, posture, and driving alert`, async () => {
  await withApp(async (app) => {
    const { source, context } = await previewAfterEvaluating(app);

    expect({
      source,
      now: context.now,
      facilityDate: context.facilityDate,
      posture: context.posture,
      hazard: context.hazard,
      urgency: context.urgency,
    }).toEqual({
      source: { kind: "preview", recommendationId: 1 },
      now: AS_OF,
      facilityDate: "2026-01-14",
      posture: { posture: "full_closure" },
      hazard: {
        kind: "winter",
        start: "2026-01-14T06:00:00.000Z",
        end: "2026-01-15T03:00:00.000Z",
      },
      urgency: "Expected",
    });
  });
});

it(`GET ${RECOMMENDATIONS_PATH}/:id/notifications/preview returns 404 for an id no recommendation has`, async () => {
  await withApp(async ({ get }) => {
    const response = await get(
      `${RECOMMENDATIONS_PATH}/${UNKNOWN_ID}/notifications/preview`,
    );

    expect([response.status, await response.json()]).toEqual([
      HTTP_NOT_FOUND,
      { message: "Recommendation not found" },
    ]);
  });
});

it(`GET ${PREVIEW_PATH} leaves notification_dispatches empty`, async () => {
  await withApp(async ({ db, get, post }) => {
    await post(EVALUATE_PATH, { asOf: AS_OF });

    const response = await get(PREVIEW_PATH);

    const dispatches = await db.select().from(notificationDispatches);
    expect([response.status, dispatches]).toEqual([HTTP_OK, []]);
  });
});
