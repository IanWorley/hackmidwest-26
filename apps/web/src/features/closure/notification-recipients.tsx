import type { JSX } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { facilityClock } from "./facility-clock";
import type {
  NotificationExclusion,
  NotificationPreview,
} from "./notification-api";
import { CHANNEL_LABELS, EXCLUSION_REASON_LABELS } from "./notification-labels";

const RECIPIENTS_LABEL = "Who will be notified";
const EXCLUSIONS_LABEL = "Not notified";
const EMPTY_TEXT = "Nobody needs a notice.";
const NAME_COLUMN = "Name";
const CHANNEL_COLUMN = "Channel";
const SEND_BY_COLUMN = "Send by";
const DELIVERY_COLUMN = "Delivery";
const LATE_TEXT = "Late";
const ON_TIME_TEXT = "On time";

function exclusionReason(exclusion: NotificationExclusion): string {
  if (exclusion.kind === "excused") {
    return exclusion.reason;
  }
  return EXCLUSION_REASON_LABELS[exclusion.reason];
}

function DeliveryCell({ late }: { late: boolean }): JSX.Element {
  if (late) {
    return <TableCell className="font-medium">{LATE_TEXT}</TableCell>;
  }
  return <TableCell>{ON_TIME_TEXT}</TableCell>;
}

function RecipientsTable({
  pkg,
  timezone,
}: {
  pkg: NotificationPreview;
  timezone: string;
}): JSX.Element {
  if (pkg.recipients.length === 0) {
    return <p className="text-muted-foreground">{EMPTY_TEXT}</p>;
  }
  return (
    <Table aria-label={RECIPIENTS_LABEL}>
      <TableHeader>
        <TableRow>
          <TableHead>{NAME_COLUMN}</TableHead>
          <TableHead>{CHANNEL_COLUMN}</TableHead>
          <TableHead>{SEND_BY_COLUMN}</TableHead>
          <TableHead>{DELIVERY_COLUMN}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pkg.recipients.map((recipient) => (
          <TableRow key={recipient.employeeId}>
            <TableCell>{recipient.name}</TableCell>
            <TableCell>{CHANNEL_LABELS[recipient.channel]}</TableCell>
            <TableCell>
              {facilityClock(recipient.sendBy, timezone, pkg.facilityDate)}
            </TableCell>
            <DeliveryCell late={recipient.late} />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Exclusions({
  exclusions,
}: {
  exclusions: readonly NotificationExclusion[];
}): JSX.Element | null {
  if (exclusions.length === 0) {
    return null;
  }
  return (
    <ul aria-label={EXCLUSIONS_LABEL} className="text-muted-foreground">
      {exclusions.map((exclusion) => (
        // Unmatched roster lines may have no employee id, so the name disambiguates.
        <li key={`${exclusion.kind}:${exclusion.employeeId}:${exclusion.name}`}>
          {`${exclusion.name}: ${exclusionReason(exclusion)}`}
        </li>
      ))}
    </ul>
  );
}

export function NotificationRecipients({
  pkg,
  timezone,
}: {
  pkg: NotificationPreview;
  timezone: string;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <h3 className="font-medium">{RECIPIENTS_LABEL}</h3>
      <RecipientsTable pkg={pkg} timezone={timezone} />
      {pkg.exclusions.length > 0 && (
        <h3 className="font-medium">{EXCLUSIONS_LABEL}</h3>
      )}
      <Exclusions exclusions={pkg.exclusions} />
    </div>
  );
}
