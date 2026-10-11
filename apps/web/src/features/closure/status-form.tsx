import { type JSX, type SubmitEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { EmployeeStatus, RecordStatus, StatusBody } from "./record-status";
import { type Person, type Recorder, STATUS_LABELS } from "./roster-filter";
import { SAVE_FAILED_MESSAGE } from "./status-messages";

const FORM_STATUSES = [
  "working_onsite",
  "teleworking",
  "not_working",
] as const satisfies readonly EmployeeStatus[];
const STATUS_LABEL = "Status";
const NOTE_LABEL = "Note";
const NOTE_HINT = "Required when not working.";
const RECORDER_LABEL = "Recorded by";
const RECORDER_PLACEHOLDER = "Choose who is recording";
const IDENTITY_NOTE = "Identity is not verified.";
const RECORDER_REQUIRED_MESSAGE = "Choose who is recording this status.";
const SUBMIT_TEXT = "Save status";
const CANCEL_TEXT = "Cancel";
const OPEN_TEXT = "Update status";
const NO_RECORDER = "";

function parseStatus(value: string): EmployeeStatus | undefined {
  return FORM_STATUSES.find((status) => status === value);
}

function parseRecorder(
  recorders: readonly Recorder[],
  value: string,
): number | undefined {
  return recorders.find((recorder) => String(recorder.id) === value)?.id;
}

/** Sends only a note with text, so a blank one reaches the API as missing and gets its message. */
function statusBody(
  status: EmployeeStatus,
  note: string,
  reportedById: number,
): StatusBody {
  if (note.trim() === "") {
    return { status, reportedById };
  }
  return { status, note, reportedById };
}

function FormError({
  id,
  message,
}: {
  id: string;
  message: string | undefined;
}): JSX.Element | null {
  if (message === undefined) {
    return null;
  }
  return (
    <p className="text-destructive text-sm" id={id} role="alert">
      {message}
    </p>
  );
}

/** A person already not working keeps their reason, so saving the same status does not need it retyped. */
function initialNote(person: Person): string {
  if (person.baseline.status === "not_working") {
    return person.baseline.note;
  }
  return "";
}

export function StatusForm({
  person,
  recorders,
  recordStatus,
  onRecorded,
}: {
  person: Person;
  recorders: readonly Recorder[];
  recordStatus: RecordStatus;
  onRecorded: () => void;
}): JSX.Element {
  const baseId = useId();
  const [status, setStatus] = useState<EmployeeStatus>(person.baseline.status);
  const [note, setNote] = useState(initialNote(person));
  const [recorderId, setRecorderId] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (recorderId === undefined) {
      setError(RECORDER_REQUIRED_MESSAGE);
      return;
    }
    setSaving(true);
    try {
      const outcome = await recordStatus(
        person.employeeId,
        statusBody(status, note, recorderId),
      );
      if (outcome.kind === "rejected") {
        setError(outcome.message);
        return;
      }
      onRecorded();
    } catch {
      setError(SAVE_FAILED_MESSAGE);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="grid gap-4" noValidate={true} onSubmit={submit}>
      <div className="grid gap-2">
        <Label htmlFor={`${baseId}-status`}>{STATUS_LABEL}</Label>
        <NativeSelect
          id={`${baseId}-status`}
          onChange={(event): void =>
            setStatus(parseStatus(event.target.value) ?? status)
          }
          value={status}
        >
          {FORM_STATUSES.map((value) => (
            <NativeSelectOption key={value} value={value}>
              {STATUS_LABELS[value]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${baseId}-note`}>{NOTE_LABEL}</Label>
        <Textarea
          aria-describedby={`${baseId}-note-hint`}
          aria-required={status === "not_working"}
          id={`${baseId}-note`}
          onChange={(event): void => setNote(event.target.value)}
          value={note}
        />
        <p className="text-muted-foreground text-xs" id={`${baseId}-note-hint`}>
          {NOTE_HINT}
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${baseId}-recorder`}>{RECORDER_LABEL}</Label>
        <NativeSelect
          aria-describedby={`${baseId}-identity`}
          aria-required={true}
          id={`${baseId}-recorder`}
          onChange={(event): void =>
            setRecorderId(parseRecorder(recorders, event.target.value))
          }
          value={String(recorderId ?? NO_RECORDER)}
        >
          <NativeSelectOption value={NO_RECORDER}>
            {RECORDER_PLACEHOLDER}
          </NativeSelectOption>
          {recorders.map((recorder) => (
            <NativeSelectOption key={recorder.id} value={String(recorder.id)}>
              {`${recorder.name}, ${recorder.role}`}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <p className="text-muted-foreground text-xs" id={`${baseId}-identity`}>
          {IDENTITY_NOTE}
        </p>
      </div>
      <FormError id={`${baseId}-error`} message={error} />
      <DialogFooter>
        <DialogClose asChild={true}>
          <Button type="button" variant="outline">
            {CANCEL_TEXT}
          </Button>
        </DialogClose>
        <Button disabled={saving} type="submit">
          {SUBMIT_TEXT}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Each row opens its own dialog, named for the person so screen readers can tell rows apart. */
export function UpdateStatusDialog({
  person,
  recorders,
  recordStatus,
}: {
  person: Person;
  recorders: readonly Recorder[];
  recordStatus: RecordStatus;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const title = `${OPEN_TEXT} for ${person.name}`;
  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild={true}>
        <Button aria-label={title} size="sm" variant="outline">
          {OPEN_TEXT}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{person.email}</DialogDescription>
        </DialogHeader>
        <StatusForm
          onRecorded={(): void => setOpen(false)}
          person={person}
          recorders={recorders}
          recordStatus={recordStatus}
        />
      </DialogContent>
    </Dialog>
  );
}
