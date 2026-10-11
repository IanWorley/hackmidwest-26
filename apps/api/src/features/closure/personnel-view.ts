import type { buildings, decisionMakers, decisions } from "@hackmidwest/db";
import type { StatusEvent } from "./baseline";
import type { Directive } from "./directives";
import {
  type Employee,
  effectiveStatus,
  type FacilityPosture,
} from "./effective-status";
import type { DecidedPosture } from "./facility-posture";
import type { PersonnelResponse } from "./personnel-schema";

/** The current decision, as the personnel view names it. */
type DecisionSummary = Pick<
  typeof decisions.$inferSelect,
  "id" | "recommendationId" | "action" | "decidedAt"
>;
type DecisionMakerRow = typeof decisionMakers.$inferSelect;
type BuildingRow = typeof buildings.$inferSelect;

/** No decision yet: the facility runs as normal. */
type CurrentPosture = DecidedPosture | { readonly kind: "none" };

/** Everything stored about one facility's people, read in one batch. */
interface PersonnelRecords {
  readonly facilityId: number;
  readonly buildings: readonly BuildingRow[];
  /** The facility's decision maker, then its backup. */
  readonly recorders: readonly DecisionMakerRow[];
  readonly employees: readonly Employee[];
  readonly statusEvents: readonly StatusEvent[];
  readonly decision: DecisionSummary | null;
  readonly posture: CurrentPosture;
  /** The current decision's directives; earlier decisions' directives no longer apply. */
  readonly directives: readonly Directive[];
}

const NORMAL: FacilityPosture = { posture: "normal" };

function reportedAfter(a: StatusEvent, b: StatusEvent): boolean {
  return (
    (Date.parse(a.reportedAt) - Date.parse(b.reportedAt) || a.id - b.id) > 0
  );
}

/** The newest event reported, which may take effect later than now. */
function latestReported(
  employeeId: number,
  statusEvents: readonly StatusEvent[],
): StatusEvent | null {
  let latest: StatusEvent | null = null;
  for (const event of statusEvents) {
    if (
      event.employeeId === employeeId &&
      (latest === null || reportedAfter(event, latest))
    ) {
      latest = event;
    }
  }
  return latest;
}

/** Only a decided posture changes anyone's day; a deferral or no decision leaves the facility normal. */
function appliedPosture(posture: CurrentPosture): FacilityPosture {
  if (posture.kind === "decided") {
    return posture.posture;
  }
  return NORMAL;
}

/**
 * Each person's baseline and, unless the posture is untimed, their effective status at `now`.
 * People come back in employee id order.
 */
function personnelView(
  records: PersonnelRecords,
  now: string,
): PersonnelResponse {
  const context = {
    facilityId: records.facilityId,
    asOf: now,
    decision: records.decision,
    buildings: records.buildings.map(({ id, name }) => ({ id, name })),
    recorders: records.recorders.map(({ id, name, role }) => ({
      id,
      name,
      role,
    })),
  };
  const facilityPosture = appliedPosture(records.posture);
  const people = [...records.employees]
    .sort((a, b) => a.id - b.id)
    .map((employee) => {
      const { baseline, effective } = effectiveStatus({
        employee,
        statusEvents: records.statusEvents,
        posture: facilityPosture,
        directives: records.directives,
        now,
      });
      return {
        person: {
          employeeId: employee.id,
          name: employee.name,
          buildingId: employee.assignedBuildingId,
          essentialPersonnel: employee.essentialPersonnel,
          teleworkEligible: employee.teleworkEligible,
          email: employee.email,
          mobilePhone: employee.mobilePhone,
          preferredChannel: employee.preferredChannel,
          hasAccessibilityNeeds: employee.accessibilityNeeds !== null,
          baseline,
          latestEvent: latestReported(employee.id, records.statusEvents),
        },
        effective,
      };
    });
  if (records.posture.kind === "untimed") {
    return {
      ...context,
      posture: records.posture,
      people: people.map(({ person }) => person),
    };
  }
  return {
    ...context,
    posture: records.posture,
    people: people.map(({ person, effective }) => ({ ...person, effective })),
  };
}

export type { CurrentPosture, PersonnelRecords };
export { personnelView };
