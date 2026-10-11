import { type JSX, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { NotificationPreview } from "./notification-api";
import { NotificationRecipients } from "./notification-recipients";
import type { ConfirmDialogState } from "./use-confirmed-decision";

const TITLE = "Confirm and notify";
const DESCRIPTION =
  "Recording this decision commits the facility to the notices below.";
const OVERRIDE_NOTE =
  "This list is for the recommended posture. Your chosen posture's notice is built after you record the decision, and only if the recommendation times it; Notifications says so when it does not.";
const CONFIRM_LABEL = "Record decision";
const BACK_LABEL = "Back";
const DEFER_TEXT =
  "A deferral sets no posture, so nobody is notified until a decision does.";
const PREVIEW_UNAVAILABLE_TEXT =
  "The notification list could not be loaded. Recording still works, and the decided package is built afterward.";

function OverrideNote({ show }: { show: boolean }): JSX.Element | null {
  if (!show) {
    return null;
  }
  return <p className="text-muted-foreground">{OVERRIDE_NOTE}</p>;
}

function Recipients({
  preview,
  timezone,
}: {
  preview: NotificationPreview | null;
  timezone: string;
}): JSX.Element {
  if (preview === null) {
    return <p role="status">{PREVIEW_UNAVAILABLE_TEXT}</p>;
  }
  return <NotificationRecipients pkg={preview} timezone={timezone} />;
}

export function ConfirmDecisionDialog({
  open,
  pending,
  onConfirm,
  onCancel,
  request,
  preview,
  timezone,
}: ConfirmDialogState & {
  preview: NotificationPreview | null;
  timezone: string;
}): JSX.Element {
  const onOpenChange = useCallback(
    (next: boolean): void => {
      if (!next) {
        onCancel();
      }
    },
    [onCancel],
  );
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-h-11/12 overflow-y-auto sm:max-w-2xl"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{TITLE}</DialogTitle>
          <DialogDescription>{DESCRIPTION}</DialogDescription>
        </DialogHeader>
        <OverrideNote show={request?.action === "override"} />
        {request?.action === "defer" && <p role="status">{DEFER_TEXT}</p>}
        {request?.action !== "defer" && (
          <Recipients preview={preview} timezone={timezone} />
        )}
        <DialogFooter>
          <Button disabled={pending} onClick={onCancel} variant="outline">
            {BACK_LABEL}
          </Button>
          <Button disabled={pending} onClick={onConfirm}>
            {CONFIRM_LABEL}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
