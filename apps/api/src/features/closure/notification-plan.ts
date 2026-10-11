import type { facilities, NotificationChannel } from "@hackmidwest/db";
import type { NwsAlert } from "../../clients/nws-model";
import type { Employee, FacilityPosture } from "./effective-status";
import {
  draftMessage,
  type MessageDraft,
  type MessageIntent,
} from "./notification-messages";
import type { HazardSpan } from "./notification-situation";
import {
  type DayPhase,
  dayPhase,
  releaseTiming,
  type WorkDay,
} from "./work-day";
import {
  type Instant,
  localInstant,
  MS_PER_MINUTE,
  parseCalendarDate,
  parseInstant,
  toInstant,
  toIso,
} from "./zoned-time";

type AlertUrgency = NwsAlert["urgency"];

/** Exactly the facility columns notices read. */
type NotificationFacility = Pick<
  typeof facilities.$inferSelect,
  | "name"
  | "timezone"
  | "arrivalWindowStart"
  | "closesAt"
  | "typicalCommuteMinutes"
  | "notificationLeadMinutes"
>;

interface NoticeContext {
  readonly facility: NotificationFacility;
  /** `YYYY-MM-DD` on the facility's wall clock, as TimingResult.facilityDate. */
  readonly facilityDate: string;
  readonly posture: FacilityPosture;
  /** Null when no hazard drives the posture, e.g. a directive under normal posture. */
  readonly hazard: HazardSpan | null;
  /** The driving alert's urgency; "Unknown" when there is no alert. */
  readonly urgency: AlertUrgency;
  readonly now: string;
}

/** The `source` fields show which override applied, so a reviewer can redo the arithmetic. */
interface StartTime {
  readonly at: string;
  readonly source: "shift" | "arrival_window";
}

interface Commute {
  readonly minutes: number;
  readonly source: "employee" | "facility";
}

/**
 * What sendBy counts back from; sendBy = anchor − facility lead either way.
 * before_commute: when they leave home (start − commute).
 * release: a timed dismissal after their start, when they are already at work (#41).
 */
type SendAnchor =
  | {
      readonly kind: "before_commute";
      readonly start: StartTime;
      readonly commute: Commute;
    }
  | { readonly kind: "release"; readonly releaseAt: string };

type Timeliness = "on_time" | "late";

type ChannelRule = "fastest" | "preferred";

interface Delivery {
  readonly anchor: SendAnchor;
  readonly sendBy: string;
  /** sendBy is before `now`. */
  readonly late: boolean;
  readonly rule: ChannelRule;
  readonly channel: NotificationChannel;
}

interface Notice {
  /** The full row: contact info, and accessibilityNeeds for a human to read. Never parsed. */
  readonly employee: Employee;
  readonly delivery: Delivery;
  readonly message: MessageDraft;
}

interface Start {
  readonly at: Instant;
  readonly source: StartTime["source"];
}

interface PersonDay {
  readonly start: Start;
  readonly day: WorkDay;
  readonly phase: DayPhase;
}

const CHANNEL_POLICY: {
  readonly [U in AlertUrgency]: Readonly<Record<Timeliness, ChannelRule>>;
} = {
  Immediate: { on_time: "fastest", late: "fastest" },
  Expected: { on_time: "preferred", late: "fastest" },
  Future: { on_time: "preferred", late: "fastest" },
  Past: { on_time: "preferred", late: "fastest" },
  Unknown: { on_time: "preferred", late: "fastest" },
};

/** The employees CHECK guarantees a preferred sms has a phone; a phone is optional otherwise. */
const CHANNEL_BY_RULE: Readonly<
  Record<ChannelRule, (employee: Employee) => NotificationChannel>
> = {
  fastest: ({ mobilePhone }) => {
    if (mobilePhone !== null && mobilePhone.trim() !== "") {
      return "sms";
    }
    return "email";
  },
  preferred: ({ preferredChannel }) => preferredChannel,
};

function startOf(
  { facility, facilityDate }: NoticeContext,
  { shiftStart }: Employee,
): Start {
  const date = parseCalendarDate(facilityDate);
  if (shiftStart !== null) {
    return {
      at: localInstant(date, shiftStart, facility.timezone),
      source: "shift",
    };
  }
  return {
    at: localInstant(date, facility.arrivalWindowStart, facility.timezone),
    source: "arrival_window",
  };
}

function commuteOf(
  { facility }: NoticeContext,
  { commuteMinutes }: Employee,
): Commute {
  if (commuteMinutes !== null) {
    return { minutes: commuteMinutes, source: "employee" };
  }
  return { minutes: facility.typicalCommuteMinutes, source: "facility" };
}

function endOf(
  { facility, facilityDate }: NoticeContext,
  { shiftEnd }: Employee,
): Instant {
  return localInstant(
    parseCalendarDate(facilityDate),
    shiftEnd ?? facility.closesAt,
    facility.timezone,
  );
}

function leadBefore(at: Instant, { facility }: NoticeContext): Instant {
  return toInstant(at - facility.notificationLeadMinutes * MS_PER_MINUTE);
}

/**
 * The commute deadline until they start work, even once it is overdue, so a dismissal reaches
 * people before or during their commute. Once they are at work, a release during their shift is the deadline.
 */
function anchorFor(
  { start, day, phase }: PersonDay,
  commute: Commute,
  intent: MessageIntent,
): { readonly anchor: SendAnchor; readonly at: Instant } {
  const beforeCommute = {
    anchor: {
      kind: "before_commute",
      start: { at: toIso(start.at), source: start.source },
      commute,
    },
    at: toInstant(start.at - commute.minutes * MS_PER_MINUTE),
  } as const;
  if (!("status" in intent) || intent.status.effective.kind !== "dismissed") {
    return beforeCommute;
  }
  const timing = releaseTiming(intent.status.effective.release, day);
  if (timing.kind !== "during_shift" || phase === "before_start") {
    return beforeCommute;
  }
  return {
    anchor: { kind: "release", releaseAt: toIso(timing.at) },
    at: timing.at,
  };
}

function timelinessOf(sendBy: Instant, now: Instant): Timeliness {
  if (sendBy < now) {
    return "late";
  }
  return "on_time";
}

/** The one place start, commute, anchor, sendBy, lateness, and channel are decided, for every intent. */
function planNotice(
  context: NoticeContext,
  employee: Employee,
  intent: MessageIntent,
): Notice {
  const { facility } = context;
  const now = parseInstant(context.now);
  const start = startOf(context, employee);
  const day = { startsAt: start.at, endsAt: endOf(context, employee) };
  const person = { start, day, phase: dayPhase(now, day) };
  const { anchor, at } = anchorFor(
    person,
    commuteOf(context, employee),
    intent,
  );
  const sendBy = leadBefore(at, context);
  const timeliness = timelinessOf(sendBy, now);
  const rule = CHANNEL_POLICY[context.urgency][timeliness];
  return {
    employee,
    delivery: {
      anchor,
      sendBy: toIso(sendBy),
      late: timeliness === "late",
      rule,
      channel: CHANNEL_BY_RULE[rule](employee),
    },
    message: draftMessage(
      {
        facilityName: facility.name,
        zone: facility.timezone,
        facilityDate: context.facilityDate,
        posture: context.posture,
        hazard: context.hazard,
        day,
        phase: person.phase,
        now,
      },
      intent,
    ),
  };
}

export type { AlertUrgency, Notice, NoticeContext };
export { planNotice };
