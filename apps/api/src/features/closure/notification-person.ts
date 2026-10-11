import type { EmployeeStatus } from "@hackmidwest/db";
import type { Release } from "./effective-status";
import { localTime, type Situation } from "./notification-situation";
import { type DayPhase, releaseTiming, type WorkDay } from "./work-day";
import { type Instant, MS_PER_MINUTE, toInstant } from "./zoned-time";

interface MessageContext extends Situation {
  readonly day: WorkDay;
  readonly phase: DayPhase;
  readonly now: Instant;
}

/** `whereabouts` is their baseline status: where they would be today without this decision. */
interface PersonContext extends MessageContext {
  readonly whereabouts: EmployeeStatus;
}

interface Instructions {
  readonly appliesToYou: string;
  readonly whatToDo: string;
}

interface DismissalCopy {
  readonly stayHome: (context: PersonContext) => string;
  readonly stopAt: (time: string, context: PersonContext) => string;
  readonly stopNow: (context: PersonContext) => string;
}

const STAY_OFF_WORK = "Stay off work as planned.";

/** Nobody is told to leave a building they are not in. */
const DISMISSAL_COPY: Readonly<Record<EmployeeStatus, DismissalCopy>> = {
  working_onsite: {
    stayHome: ({ facilityName }) => `Do not report to ${facilityName} today.`,
    stopAt: (time, { facilityName }) => `Leave ${facilityName} at ${time}.`,
    stopNow: ({ facilityName }) => `Leave ${facilityName} now.`,
  },
  teleworking: {
    stayHome: () => "Do not work today.",
    stopAt: (time) => `Stop work at ${time}.`,
    stopNow: () => "Stop work now.",
  },
  not_working: {
    stayHome: () => STAY_OFF_WORK,
    stopAt: () => STAY_OFF_WORK,
    stopNow: () => STAY_OFF_WORK,
  },
};

function delayedArrival(
  delayMinutes: number,
  context: PersonContext,
): Instructions {
  const { day } = context;
  const arriveAt = toInstant(day.startsAt + delayMinutes * MS_PER_MINUTE);
  const appliesToYou = `Your arrival is delayed by ${delayMinutes} minutes.`;
  if (arriveAt >= day.endsAt) {
    return {
      appliesToYou: `${appliesToYou} Your shift ends at ${localTime(day.endsAt, context)}, before the delayed arrival.`,
      whatToDo: `Do not report to ${context.facilityName} today.`,
    };
  }
  if (arriveAt <= context.now) {
    return {
      appliesToYou,
      whatToDo: `Report to ${context.facilityName} now.`,
    };
  }
  return {
    appliesToYou,
    whatToDo: `Arrive by ${localTime(arriveAt, context)} instead of ${startTime(context)}.`,
  };
}

/** "As usual" only for someone who normally works onsite; once the shift has begun, "now". */
function reportInPerson(context: PersonContext): string {
  const { facilityName } = context;
  const onsite = context.whereabouts === "working_onsite";
  if (context.phase === "before_start" && onsite) {
    return `Report to ${facilityName} at ${startTime(context)} as usual.`;
  }
  if (context.phase === "before_start") {
    return `Report to ${facilityName} by ${startTime(context)}.`;
  }
  if (onsite) {
    return `Report to ${facilityName} now if you are not already there.`;
  }
  return `Report to ${facilityName} now.`;
}

function workFromHome(context: PersonContext): string {
  const { facilityName } = context;
  if (
    context.phase !== "before_start" &&
    context.whereabouts === "working_onsite"
  ) {
    return `Leave ${facilityName} and work from home for the rest of the day.`;
  }
  return `Work from home. Do not travel to ${facilityName}.`;
}

/** Before the shift they stay home; once it has begun they stop now. */
function notToday(copy: DismissalCopy, context: PersonContext): string {
  if (context.phase === "before_start") {
    return copy.stayHome(context);
  }
  return copy.stopNow(context);
}

function dismissal(release: Release, context: PersonContext): Instructions {
  const copy = DISMISSAL_COPY[context.whereabouts];
  const timing = releaseTiming(release, context.day);
  switch (timing.kind) {
    case "all_day":
      if (context.phase !== "before_start") {
        return {
          appliesToYou: "You are dismissed for the rest of the day.",
          whatToDo: copy.stopNow(context),
        };
      }
      return {
        appliesToYou: "You are dismissed for the day.",
        whatToDo: copy.stayHome(context),
      };
    case "before_start":
      return {
        appliesToYou: `Your release time, ${localTime(timing.at, context)}, is no later than your ${startTime(context)} start.`,
        whatToDo: notToday(copy, context),
      };
    case "during_shift": {
      const time = localTime(timing.at, context);
      if (timing.at <= context.now) {
        return {
          appliesToYou: `You were released early at ${time}.`,
          whatToDo: copy.stopNow(context),
        };
      }
      return {
        appliesToYou: `You are released early at ${time}.`,
        whatToDo: copy.stopAt(time, context),
      };
    }
    case "after_shift":
      return {
        appliesToYou: `Your shift ends at ${localTime(context.day.endsAt, context)}, no later than the ${localTime(timing.at, context)} release.`,
        whatToDo: "Work your normal hours.",
      };
    default:
      return timing satisfies never;
  }
}

function startTime(context: MessageContext): string {
  return localTime(context.day.startsAt, context);
}

export type { Instructions, MessageContext, PersonContext };
export { delayedArrival, dismissal, reportInPerson, workFromHome };
