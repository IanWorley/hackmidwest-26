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
import type { ConfirmDialogState } from "./use-confirmed-submit";

const TITLE = "Confirm and notify";
const DESCRIPTION =
  "Recording this decision commits the facility to the notices below.";
const OVERRIDE_NOTE =
  "This list is for the recommended posture. The notice for your chosen posture is built after you record the decision.";
const CONFIRM_LABEL = "Record decision";
const BACK_LABEL = "Back";

function OverrideNote({ show }: { show: boolean }): JSX.Element | null {
  if (!show) {
    return null;
  }
  return <p className="text-muted-foreground">{OVERRIDE_NOTE}</p>;
}

export function ConfirmDecisionDialog({
  open,
  pending,
  onConfirm,
  onCancel,
  preview,
  timezone,
  chosenDiffersFromRecommended,
}: ConfirmDialogState & {
  preview: NotificationPreview;
  timezone: string;
  chosenDiffersFromRecommended: boolean;
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
      <DialogContent className="sm:max-w-2xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{TITLE}</DialogTitle>
          <DialogDescription>{DESCRIPTION}</DialogDescription>
        </DialogHeader>
        <OverrideNote show={chosenDiffersFromRecommended} />
        <NotificationRecipients pkg={preview} timezone={timezone} />
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
