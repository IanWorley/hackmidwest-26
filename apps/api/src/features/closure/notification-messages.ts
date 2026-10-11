import type { EmployeeStatus } from "@hackmidwest/db";
import type { DirectiveScopeKind } from "./directives";
import type {
  Cause,
  EffectiveStatus,
  EffectiveStatusKind,
  PersonnelStatus,
  Release,
} from "./effective-status";
import {
  allClearHappening,
  happening,
  headline,
  localTime,
  type Situation,
} from "./notification-situation";
import { releaseTiming } from "./release-timing";
import { type Instant, MS_PER_MINUTE, toInstant } from "./zoned-time";

/** Three parts per #29: what is happening, whether it applies to you, what to do. */
interface MessageDraft {
  readonly subject: string;
  readonly whatsHappening: string;
  readonly appliesToYou: string;
  readonly whatToDo: string;
}

/** Why a message exists. Follow-ups are intents over the same planner, not separate pipelines. */
type MessageIntent =
  | { readonly kind: "initial"; readonly status: PersonnelStatus }
  | { readonly kind: "update"; readonly status: PersonnelStatus }
  | { readonly kind: "withdrawn" }
  | { readonly kind: "all_clear"; readonly resumesOn: string };

interface MessageContext extends Situation {
  /** This person's shift start, else the arrival window start, on the facility date. */
  readonly workStartsAt: Instant;
  /** Null when they have no shift of their own. */
  readonly workEndsAt: Instant | null;
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

type StatusTemplate<K extends EffectiveStatusKind> = (
  status: Extract<EffectiveStatus, { readonly kind: K }>,
  context: PersonContext,
) => Instructions;

interface DismissalCopy {
  readonly stayHome: (context: PersonContext) => string;
  readonly stopAt: (time: string, context: PersonContext) => string;
  readonly stopNow: (context: PersonContext) => string;
}

const UPDATED_PREFIX = "Updated: ";
const REPLACES_EARLIER_NOTICE =
  "This replaces the notice sent for the earlier decision.";
const WITHDRAWN: Instructions = {
  appliesToYou:
    "The notice sent for the earlier decision no longer applies to you.",
  whatToDo: "Follow your usual schedule.",
};
const STAY_OFF_WORK = "Stay off work as planned.";

const DIRECTIVE_SCOPE_PHRASE: Readonly<Record<DirectiveScopeKind, string>> = {
  facility: "A manager issued a directive for the whole facility",
  group: "A manager issued a directive for essential personnel",
  building: "A manager issued a directive for your building",
  employee: "A manager issued a directive for you",
};

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

const STATUS_TEMPLATES: {
  readonly [K in EffectiveStatusKind]: StatusTemplate<K>;
} = {
  working_onsite: (_status, context) => ({
    appliesToYou: "The office stays open for you.",
    whatToDo: `Report to ${context.facilityName} at ${startTime(context)} as usual.`,
  }),
  teleworking: (_status, { facilityName }) => ({
    appliesToYou: "You are teleworking today.",
    whatToDo: `Work from home. Do not travel to ${facilityName}.`,
  }),
  delayed_arrival: ({ delayMinutes }, context) =>
    delayedArrival(delayMinutes, context),
  report_required: (_status, context) => ({
    appliesToYou: "You are required to report in person.",
    whatToDo: reportInPerson(context),
  }),
  dismissed: ({ release }, context) => dismissal(release, context),
  not_working: () => ({
    appliesToYou: "You are not expected at work today.",
    whatToDo: "Do not report today.",
  }),
};

function delayedArrival(
  delayMinutes: number,
  context: PersonContext,
): Instructions {
  const arriveAt = toInstant(
    context.workStartsAt + delayMinutes * MS_PER_MINUTE,
  );
  const appliesToYou = `Your arrival is delayed by ${delayMinutes} minutes.`;
  if (context.workEndsAt !== null && arriveAt >= context.workEndsAt) {
    return {
      appliesToYou: `${appliesToYou} Your shift ends at ${localTime(context.workEndsAt, context)}, before the delayed arrival.`,
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

/** "As usual" only for someone who normally works onsite; anyone else is told when, or now. */
function reportInPerson(context: PersonContext): string {
  const { facilityName } = context;
  if (context.whereabouts === "working_onsite") {
    return `Report to ${facilityName} at ${startTime(context)} as usual.`;
  }
  if (context.workStartsAt <= context.now) {
    return `Report to ${facilityName} now.`;
  }
  return `Report to ${facilityName} by ${startTime(context)}.`;
}

function dismissal(release: Release, context: PersonContext): Instructions {
  const copy = DISMISSAL_COPY[context.whereabouts];
  const timing = releaseTiming(
    release,
    context.workStartsAt,
    context.workEndsAt,
  );
  switch (timing.kind) {
    case "all_day":
      if (context.workStartsAt <= context.now) {
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
        whatToDo: copy.stayHome(context),
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
        appliesToYou: `Your shift ends at ${localTime(timing.endsAt, context)}, no later than the ${localTime(timing.at, context)} release.`,
        whatToDo: "Work your normal hours.",
      };
    default:
      return timing satisfies never;
  }
}

function startTime(context: MessageContext): string {
  return localTime(context.workStartsAt, context);
}

function template<K extends EffectiveStatusKind>(
  status: Extract<EffectiveStatus, { readonly kind: K }>,
  context: PersonContext,
): Instructions {
  return STATUS_TEMPLATES[status.kind](status, context);
}

function withCause(text: string, cause: Cause): string {
  if (cause.source !== "directive") {
    return text;
  }
  const { scope, reasonText } = cause.directive;
  return `${text} ${DIRECTIVE_SCOPE_PHRASE[scope.kind]}: ${reasonText}`;
}

function instructionsFor(
  { baseline, effective }: PersonnelStatus,
  context: MessageContext,
): Instructions {
  const { appliesToYou, whatToDo } = template(effective, {
    ...context,
    whereabouts: baseline.status,
  });
  return { appliesToYou: withCause(appliesToYou, effective.cause), whatToDo };
}

/** Every user-facing string comes from here or notification-situation.ts; effective status deliberately builds none. */
function draftMessage(
  context: MessageContext,
  intent: MessageIntent,
): MessageDraft {
  const subject = headline(context);
  switch (intent.kind) {
    case "initial":
      return {
        subject,
        whatsHappening: happening(context),
        ...instructionsFor(intent.status, context),
      };
    case "update": {
      const { appliesToYou, whatToDo } = instructionsFor(
        intent.status,
        context,
      );
      return {
        subject: `${UPDATED_PREFIX}${subject}`,
        whatsHappening: happening(context),
        appliesToYou: `${REPLACES_EARLIER_NOTICE} ${appliesToYou}`,
        whatToDo,
      };
    }
    case "withdrawn":
      return {
        subject: `${UPDATED_PREFIX}${subject}`,
        whatsHappening: happening(context),
        ...WITHDRAWN,
      };
    case "all_clear":
      return {
        subject: `All clear: ${context.facilityName}`,
        whatsHappening: allClearHappening(
          context,
          intent.resumesOn,
          context.now,
        ),
        appliesToYou:
          "Your earlier instructions end when normal operations resume.",
        whatToDo: `Return to your usual schedule on ${intent.resumesOn}.`,
      };
    default:
      return intent satisfies never;
  }
}

export type { MessageDraft, MessageIntent };
export { draftMessage };
