import type { DirectiveScopeKind } from "./directives";
import type {
  Cause,
  EffectiveStatus,
  EffectiveStatusKind,
  PersonnelStatus,
} from "./effective-status";
import {
  delayedArrival,
  dismissal,
  type Instructions,
  type MessageContext,
  type PersonContext,
  reportInPerson,
  workFromHome,
} from "./notification-person";
import {
  allClearHappening,
  happening,
  headline,
} from "./notification-situation";
import { calendarDate, formatDate } from "./zoned-time";

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

type StatusTemplate<K extends EffectiveStatusKind> = (
  status: Extract<EffectiveStatus, { readonly kind: K }>,
  context: PersonContext,
) => Instructions;

const UPDATED_PREFIX = "Updated: ";
const REPLACES_EARLIER_NOTICE =
  "This replaces the notice sent for the earlier decision.";
const WITHDRAWN: Instructions = {
  appliesToYou:
    "The notice sent for the earlier decision no longer applies to you.",
  whatToDo: "Follow your usual schedule.",
};
const SHIFT_OVER = "Your shift today has ended, so no action is needed.";

const DIRECTIVE_SCOPE_PHRASE: Readonly<Record<DirectiveScopeKind, string>> = {
  facility: "A manager issued a directive for the whole facility",
  group: "A manager issued a directive for essential personnel",
  building: "A manager issued a directive for your building",
  employee: "A manager issued a directive for you",
};

const STATUS_TEMPLATES: {
  readonly [K in EffectiveStatusKind]: StatusTemplate<K>;
} = {
  working_onsite: (_status, context) => ({
    appliesToYou: "The office stays open for you.",
    whatToDo: reportInPerson(context),
  }),
  teleworking: (_status, context) => ({
    appliesToYou: "You are teleworking today.",
    whatToDo: workFromHome(context),
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
  if (context.phase === "after_shift") {
    return {
      appliesToYou: withCause(appliesToYou, effective.cause),
      whatToDo: SHIFT_OVER,
    };
  }
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
        ...allClearInstructions(intent.resumesOn, context),
      };
    default:
      return intent satisfies never;
  }
}

/** Tied to the resume date itself, so it never implies a closure the original package did not have. */
function allClearInstructions(
  resumesOn: string,
  context: MessageContext,
): Instructions {
  const today = formatDate(calendarDate(context.now, context.zone));
  if (today >= resumesOn) {
    return {
      appliesToYou: "Your earlier instructions no longer apply.",
      whatToDo: "Resume your usual schedule now.",
    };
  }
  return {
    appliesToYou: `Your earlier instructions stay in effect until ${resumesOn}.`,
    whatToDo: `Return to your usual schedule on ${resumesOn}.`,
  };
}

export type { MessageDraft, MessageIntent };
export { draftMessage };
