import {
  createTestDatabaseWithDemoFacilities,
  DEMO_ROSTER_CASES,
} from "@hackmidwest/db/testing";
import { expect, it } from "vitest";
import { type DirectiveRow, directiveRecordOf } from "./directive-history";
import { reconcileKansasCityOn } from "./roster-test-fixtures";

const RELEASE_AT = "2026-10-12T19:00:00.000Z";
const EARLIER_RELEASE_AT = "2026-10-12T17:30:00.000Z";
const ONSITE_EMPLOYEE_ID = 1;
const UNCHECKED_HASH =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

function storedDirective(
  fields: Pick<DirectiveRow, "id" | "scope" | "directive"> &
    Partial<DirectiveRow>,
): DirectiveRow {
  return {
    decisionId: 1,
    decisionHash: UNCHECKED_HASH,
    effectiveAt: null,
    reasonCategory: "essential_operations",
    reasonText: "Plant operators keep the boilers running.",
    issuedById: 1,
    issuedAt: "2026-10-12T10:00:00.000Z",
    contentHash: UNCHECKED_HASH,
    ...fields,
  };
}

it("applies the #41 early-dismissal example to four seeded employees read from stored directives", async () => {
  const directives = [
    storedDirective({ id: 1, scope: "group:essential", directive: "report" }),
    storedDirective({
      id: 2,
      scope: `employee:${DEMO_ROSTER_CASES.accessibilityNeedsEmployeeId}`,
      directive: "dismissed",
      effectiveAt: EARLIER_RELEASE_AT,
      reasonCategory: "road_reports",
      reasonText: "Accessible entrance will not be cleared after 11:30.",
    }),
  ].map(directiveRecordOf);

  const { notify, skip } = await reconcileKansasCityOn(
    createTestDatabaseWithDemoFacilities,
    { posture: "early_dismissal", releaseAt: RELEASE_AT },
    directives,
  );

  expect(
    [
      ONSITE_EMPLOYEE_ID,
      DEMO_ROSTER_CASES.alreadyTeleworkingEmployeeId,
      DEMO_ROSTER_CASES.essentialMainOfficeEmployeeId,
      DEMO_ROSTER_CASES.accessibilityNeedsEmployeeId,
    ].map((id) => {
      const line = [...notify, ...skip].find(
        ({ employee }) => employee.id === id,
      );
      const { cause, ...effective } = line?.status.effective ?? {};
      return { reason: line?.reason, effective, cause: cause?.source };
    }),
  ).toEqual([
    {
      reason: "status_changes",
      effective: { kind: "dismissed", release: { at: RELEASE_AT } },
      cause: "posture",
    },
    {
      reason: "already_teleworking",
      effective: { kind: "teleworking" },
      cause: "baseline",
    },
    {
      reason: "status_changes",
      effective: { kind: "report_required" },
      cause: "directive",
    },
    {
      reason: "status_changes",
      effective: { kind: "dismissed", release: { at: EARLIER_RELEASE_AT } },
      cause: "directive",
    },
  ]);
});
