import { expect, it } from "vitest";
import { evaluatePosture } from "./engine";
import {
  ALL_DAY_END,
  alerts,
  input,
  NOW,
  nwsAlert,
} from "./engine-test-fixtures";
import { noticeContext } from "./notification-context";
import { packageInput } from "./notification-test-fixtures";
import { parseSnapshot } from "./recommendation-store";

it("takes the hazard and urgency from the alert behind the deciding finding", () => {
  const engineInput = input(["winter"], {
    alerts: alerts(
      { ...nwsAlert("Winter Storm Watch", "Severe"), urgency: "Future" },
      {
        ...nwsAlert("Winter Storm Warning", "Severe", ALL_DAY_END),
        urgency: "Immediate",
      },
    ),
  });
  const snapshot = parseSnapshot(
    JSON.parse(
      JSON.stringify({
        input: engineInput,
        output: evaluatePosture(engineInput),
      }),
    ),
  );

  const context = noticeContext({
    facility: packageInput({}).facility,
    snapshot,
    posture: { posture: "full_closure" },
    now: NOW,
  });

  expect([context.facilityDate, context.hazard, context.urgency]).toEqual([
    "2026-01-14",
    {
      kind: "winter",
      start: "2026-01-14T06:00:00.000Z",
      end: "2026-01-15T03:00:00.000Z",
    },
    "Immediate",
  ]);
});
