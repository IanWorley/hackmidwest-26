import type { Hazard } from "@hackmidwest/db";
import type { FacilityPosture } from "./effective-status";
import type { Posture } from "./postures";
import {
  calendarDate,
  formatDate,
  formatTimeOfDay,
  type Instant,
  parseInstant,
} from "./zoned-time";

interface HazardSpan {
  readonly kind: Hazard;
  readonly start: string;
  readonly end: string;
}

/** The facility-wide facts every message in one package shares. */
interface Situation {
  readonly facilityName: string;
  readonly zone: string;
  readonly posture: FacilityPosture;
  readonly hazard: HazardSpan | null;
}

type Headline<P extends Posture> = (
  posture: FacilityPosture<P>,
  situation: Situation,
) => string;

const HAZARD_LABEL: Readonly<Record<Hazard, string>> = {
  winter: "Winter weather",
  wind: "High winds",
  airQuality: "Poor air quality",
  flood: "Flooding",
};

const POSTURE_HEADLINE: { readonly [P in Posture]: Headline<P> } = {
  normal: (_posture, { facilityName }) =>
    `${facilityName} is open on its normal schedule`,
  delayed_arrival: ({ delayMinutes }, { facilityName }) =>
    `${facilityName} has a ${delayMinutes}-minute delayed arrival`,
  early_dismissal: ({ releaseAt }, situation) =>
    `${situation.facilityName} closes early at ${localTime(parseInstant(releaseAt), situation)}`,
  unscheduled_telework: (_posture, { facilityName }) =>
    `${facilityName} is on unscheduled telework`,
  full_closure: (_posture, { facilityName }) => `${facilityName} is closed`,
};

function localTime(at: Instant, { zone }: Pick<Situation, "zone">): string {
  return formatTimeOfDay(at, zone);
}

function postureHeadline<P extends Posture>(
  posture: FacilityPosture<P>,
  situation: Situation,
): string {
  return POSTURE_HEADLINE[posture.posture](posture, situation);
}

function headline(situation: Situation): string {
  return postureHeadline(situation.posture, situation);
}

/** Dates join the times only when the window crosses a facility day, so a 28-hour storm never reads as overnight. */
function hazardWindow(
  { start, end }: HazardSpan,
  situation: Situation,
): string {
  const from = parseInstant(start);
  const to = parseInstant(end);
  const fromDate = formatDate(calendarDate(from, situation.zone));
  const toDate = formatDate(calendarDate(to, situation.zone));
  if (fromDate === toDate) {
    return `from ${localTime(from, situation)} to ${localTime(to, situation)}`;
  }
  return `from ${fromDate} ${localTime(from, situation)} to ${toDate} ${localTime(to, situation)}`;
}

function happening(situation: Situation): string {
  const facility = `${headline(situation)}.`;
  const { hazard } = situation;
  if (hazard === null) {
    return facility;
  }
  return `${HAZARD_LABEL[hazard.kind]} expected ${hazardWindow(hazard, situation)}. ${facility}`;
}

/** Names only what the original package had: a hazard that ended (or will), a facility that reopens. */
function allClearHappening(
  situation: Situation,
  resumesOn: string,
  now: Instant,
): string {
  const { facilityName, hazard, posture } = situation;
  let operations = `${facilityName} resumes normal operations on ${resumesOn}.`;
  if (posture.posture === "normal") {
    operations = `${facilityName} continues normal operations on ${resumesOn}.`;
  }
  if (hazard === null) {
    return operations;
  }
  const end = parseInstant(hazard.end);
  if (now < end) {
    const endsAt = `${formatDate(calendarDate(end, situation.zone))} ${localTime(end, situation)}`;
    return `${HAZARD_LABEL[hazard.kind]} is expected to end by ${endsAt}. ${operations}`;
  }
  return `${HAZARD_LABEL[hazard.kind]} has ended. ${operations}`;
}

export type { HazardSpan, Situation };
export { allClearHappening, happening, headline, localTime };
