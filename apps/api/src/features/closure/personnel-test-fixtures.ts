import { recommendations } from "@hackmidwest/db";
import { HTTP_OK } from "../../runtime";
import { type Db, FACILITY_ID, RECOMMENDATION } from "./decision-test-fixtures";
import { evaluatePosture } from "./engine";
import type { EngineInput } from "./engine-input";
import {
  AFTERNOON_HOUR,
  ALL_DAY_END,
  alerts,
  forecast,
  input,
  nwsAlert,
} from "./engine-test-fixtures";
import type { PersonnelResponse } from "./personnel-schema";
import { parseSnapshot, type Snapshot } from "./recommendation-store";
import { contentHash, type JsonValue } from "./records";

const AVERY_TELEWORK_ELIGIBLE = 1;
const BIANCA_ESSENTIAL = 2;
const DELIA_ALREADY_TELEWORKING = 4;
const HANA_ACCESSIBILITY_NEEDS = 8;
const LATER = "2026-10-02T14:00:00.000Z";
/** 03:00 in Kansas City on the engine fixtures' facility day, 2026-01-14. */
const ON_FIXTURE_DAY = "2026-01-14T09:00:00.000Z";
/** After Kansas City closes on 2026-01-14, when decisions are about 2026-01-15. */
const AFTER_FIXTURE_DAY_CLOSE = "2026-01-14T23:00:00.000Z";
const WIND_RELEASE_AT = "2026-01-14T17:45:00.000Z";
const EARLIER_RELEASE_AT = "2026-01-14T16:30:00.000Z";
const SUSTAINED_WIND_DISMISSAL = input(["wind"], {
  forecast: forecast([...AFTERNOON_HOUR, "40 mph"]),
});
const ALL_DAY_CLOSURE = input(["winter"], {
  alerts: alerts(nwsAlert("Winter Storm Warning", "Severe", ALL_DAY_END)),
});
const REASON = {
  category: "road_reports",
  text: "County reports the highway closed.",
} as const;

const PERSONNEL_PATH = `/api/facilities/${FACILITY_ID}/personnel`;

function jsonOf(snapshot: Snapshot): JsonValue {
  return JSON.parse(JSON.stringify(snapshot));
}

/** Stores the engine's recommendation for `engineInput` at facility 1, and returns its id. */
async function stageRecommendation(
  db: Db,
  engineInput: EngineInput,
): Promise<number> {
  const output = evaluatePosture(engineInput);
  const content = {
    ...RECOMMENDATION,
    posture: output.status.posture,
    snapshot: jsonOf(parseSnapshot({ input: engineInput, output })),
  };
  const [row] = await db
    .insert(recommendations)
    .values({ ...content, contentHash: contentHash(content) })
    .returning({ id: recommendations.id });
  if (row === undefined) {
    throw new Error("The recommendation insert returned no row");
  }
  return row.id;
}

async function personnel(
  request: (path: string, body?: object) => Promise<Response>,
): Promise<PersonnelResponse> {
  const response = await request(PERSONNEL_PATH);
  if (response.status !== HTTP_OK) {
    throw new Error(`GET ${PERSONNEL_PATH} answered ${response.status}`);
  }
  return response.json();
}

function person(
  body: PersonnelResponse,
  id: number,
): PersonnelResponse["people"][number] | undefined {
  return body.people.find(({ employeeId }) => employeeId === id);
}

export {
  AFTER_FIXTURE_DAY_CLOSE,
  ALL_DAY_CLOSURE,
  AVERY_TELEWORK_ELIGIBLE,
  BIANCA_ESSENTIAL,
  DELIA_ALREADY_TELEWORKING,
  EARLIER_RELEASE_AT,
  HANA_ACCESSIBILITY_NEEDS,
  LATER,
  ON_FIXTURE_DAY,
  person,
  personnel,
  REASON,
  SUSTAINED_WIND_DISMISSAL,
  stageRecommendation,
  WIND_RELEASE_AT,
};
