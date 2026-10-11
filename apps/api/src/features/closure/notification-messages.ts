import type { Hazard } from "@hackmidwest/db";
import type { DirectiveScopeKind } from "./directives";
import type {
  Cause,
  EffectiveStatus,
  EffectiveStatusKind,
  FacilityPosture,
  Release,
} from "./effective-status";
import type { Posture } from "./postures";
import {
  formatTimeOfDay,
  type Instant,
  MS_PER_MINUTE,
  parseInstant,
  toInstant,
} from "./zoned-time";

interface HazardSpan {
  readonly kind: Hazard;
  readonly start: string;
  readonly end: string;
}

/** Three parts per #29: what is happening, whether it applies to you, what to do. */
interface MessageDraft {
  readonly subject: string;
  readonly whatsHappening: string;
  readonly appliesToYou: string;
  readonly whatToDo: string;
}

/** Why a message exists. Follow-ups are intents over the same planner, not separate pipelines. */
type MessageIntent =
  | { readonly kind: "initial"; readonly status: EffectiveStatus }
  | { readonly kind: "update"; readonly status: EffectiveStatus }
  | { readonly kind: "withdrawn" }
  | { readonly kind: "all_clear"; readonly resumesOn: string };

interface MessageContext {
  readonly facilityName: string;
  readonly zone: string;
  readonly posture: FacilityPosture;
  readonly hazard: HazardSpan | null;
  /** This person's shift start, else the arrival window start, on the facility date. */
  readonly workStartsAt: Instant;
}

interface Instructions {
  readonly appliesToYou: string;
  readonly whatToDo: string;
}

type StatusTemplate<K extends EffectiveStatusKind> = (
  status: Extract<EffectiveStatus, { readonly kind: K }>,
  context: MessageContext,
) => Instructions;

type Headline<P extends Posture> = (
  posture: FacilityPosture<P>,
  context: MessageContext,
) => string;

const UPDATED_PREFIX = "Updated: ";
const REPLACES_EARLIER_NOTICE =
  "This replaces the notice sent for the earlier decision.";
const WITHDRAWN: Instructions = {
  appliesToYou:
    "The notice sent for the earlier decision no longer applies to you.",
  whatToDo: "Follow your usual schedule.",
};
const ALL_CLEAR: Instructions = {
  appliesToYou: "Your earlier instructions no longer apply.",
  whatToDo: "Follow your usual schedule.",
};

const HAZARD_LABEL: Readonly<Record<Hazard, string>> = {
  winter: "Winter weather",
  wind: "High winds",
  airQuality: "Poor air quality",
  flood: "Flooding",
};

const DIRECTIVE_SCOPE_PHRASE: Readonly<Record<DirectiveScopeKind, string>> = {
  facility: "A manager issued a directive for the whole facility",
  group: "A manager issued a directive for essential personnel",
  building: "A manager issued a directive for your building",
  employee: "A manager issued a directive for you",
};

const POSTURE_HEADLINE: { readonly [P in Posture]: Headline<P> } = {
  normal: (_posture, { facilityName }) =>
    `${facilityName} is open on its normal schedule`,
  delayed_arrival: ({ delayMinutes }, { facilityName }) =>
    `${facilityName} opens ${delayMinutes} minutes late`,
  early_dismissal: ({ releaseAt }, { facilityName, zone }) =>
    `${facilityName} closes early at ${formatTimeOfDay(parseInstant(releaseAt), zone)}`,
  unscheduled_telework: (_posture, { facilityName }) =>
    `${facilityName} is on unscheduled telework`,
  full_closure: (_posture, { facilityName }) => `${facilityName} is closed`,
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
  delayed_arrival: ({ delayMinutes }, context) => ({
    appliesToYou: `Your arrival is delayed by ${delayMinutes} minutes.`,
    whatToDo: `Arrive by ${formatTimeOfDay(toInstant(context.workStartsAt + delayMinutes * MS_PER_MINUTE), context.zone)} instead of ${startTime(context)}.`,
  }),
  report_required: (_status, context) => ({
    appliesToYou: "You are required to report in person.",
    whatToDo: `Report to ${context.facilityName} at ${startTime(context)} as usual.`,
  }),
  dismissed: ({ release }, context) => dismissal(release, context),
  not_working: () => ({
    appliesToYou: "You are not expected at work today.",
    whatToDo: "Do not report today.",
  }),
};

/**
 * A timed release strictly after this person's start, when they are already at work.
 * The planner anchors sendBy on it and the dismissal wording says "leave at", so both share this rule.
 */
function releaseAfterStart(release: Release, start: Instant): Instant | null {
  if (release === "all_day") {
    return null;
  }
  const at = parseInstant(release.at);
  if (at > start) {
    return at;
  }
  return null;
}

function dismissal(release: Release, context: MessageContext): Instructions {
  const { facilityName, zone } = context;
  if (release === "all_day") {
    return {
      appliesToYou: "You are dismissed for the day.",
      whatToDo: `Do not report to ${facilityName} today.`,
    };
  }
  const releaseTime = formatTimeOfDay(parseInstant(release.at), zone);
  if (releaseAfterStart(release, context.workStartsAt) === null) {
    return {
      appliesToYou: `You are released at ${releaseTime}, before your ${startTime(context)} start.`,
      whatToDo: "Do not report today.",
    };
  }
  return {
    appliesToYou: `You are released early at ${releaseTime}.`,
    whatToDo: `Leave ${facilityName} at ${releaseTime}.`,
  };
}

function startTime({ workStartsAt, zone }: MessageContext): string {
  return formatTimeOfDay(workStartsAt, zone);
}

function headline<P extends Posture>(
  posture: FacilityPosture<P>,
  context: MessageContext,
): string {
  return POSTURE_HEADLINE[posture.posture](posture, context);
}

function template<K extends EffectiveStatusKind>(
  status: Extract<EffectiveStatus, { readonly kind: K }>,
  context: MessageContext,
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
  status: EffectiveStatus,
  context: MessageContext,
): Instructions {
  const { appliesToYou, whatToDo } = template(status, context);
  return { appliesToYou: withCause(appliesToYou, status.cause), whatToDo };
}

function happening(context: MessageContext): string {
  const facility = `${headline(context.posture, context)}.`;
  const { hazard, zone } = context;
  if (hazard === null) {
    return facility;
  }
  const from = formatTimeOfDay(parseInstant(hazard.start), zone);
  const to = formatTimeOfDay(parseInstant(hazard.end), zone);
  return `${HAZARD_LABEL[hazard.kind]} expected from ${from} to ${to}. ${facility}`;
}

/** Every user-facing string comes from here; effective status deliberately builds none. */
function draftMessage(
  context: MessageContext,
  intent: MessageIntent,
): MessageDraft {
  const subject = headline(context.posture, context);
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
        subject: `All clear: ${context.facilityName} resumes normal operations`,
        whatsHappening: `The hazard is over. ${context.facilityName} resumes normal operations on ${intent.resumesOn}.`,
        ...ALL_CLEAR,
      };
    default:
      return intent satisfies never;
  }
}

export type { HazardSpan, MessageDraft, MessageIntent };
export { draftMessage, releaseAfterStart };
