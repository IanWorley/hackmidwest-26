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
import { SAVE_UNCONFIRMED_MESSAGE } from "./status-messages";

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
const BASELINE_CHANGED_SUFFIX =
  "'s status changed while this form was open. The form now shows the current status.";
/**
 * Where the dialog's latest save stands. "unconfirmed" means the request got no answer and may
 * still have been stored.
 */
type SaveState = "idle" | "saving" | "unconfirmed";

/** Keys the form for a person with no recorded status event yet. */
const NO_BASELINE_EVENT = "none";

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
  // Only a not_working status carries a reason; a working status must not keep the old one.
  if (status !== "not_working" || note.trim() === "") {
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

function BaselineChangedNotice({
  name,
  shown,
}: {
  name: string;
  shown: boolean;
}): JSX.Element | null {
  if (!shown) {
    return null;
  }
  return (
    <p className="text-sm" role="status">
      {`${name}${BASELINE_CHANGED_SUFFIX}`}
    </p>
  );
}

function RecorderField({
  id,
  recorders,
  recorderId,
  onChange,
}: {
  id: string;
  recorders: readonly Recorder[];
  recorderId: number | undefined;
  onChange: (recorderId: number | undefined) => void;
}): JSX.Element {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{RECORDER_LABEL}</Label>
      <NativeSelect
        aria-describedby={`${id}-identity`}
        aria-required={true}
        id={id}
        onChange={(event): void =>
          onChange(parseRecorder(recorders, event.target.value))
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
      <p className="text-muted-foreground text-xs" id={`${id}-identity`}>
        {IDENTITY_NOTE}
      </p>
    </div>
  );
}

/** A form error wins; an unconfirmed save otherwise keeps its warning up until the next save. */
function formMessage(
  error: string | undefined,
  saveState: SaveState,
): string | undefined {
  if (error === undefined && saveState === "unconfirmed") {
    return SAVE_UNCONFIRMED_MESSAGE;
  }
  return error;
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
  saveState,
  onSaveStateChange,
  baselineChanged,
}: {
  person: Person;
  recorders: readonly Recorder[];
  recordStatus: RecordStatus;
  onRecorded: () => void;
  /**
   * Owned by the dialog, which must not close while a save is in flight. An unconfirmed save
   * reloads the roster, which can reset this form before its own catch runs, so the warning must
   * outlive the form that raised it.
   */
  saveState: SaveState;
  onSaveStateChange: (saveState: SaveState) => void;
  /** The person's status changed after the dialog opened, so the form was reset to it. */
  baselineChanged: boolean;
}): JSX.Element {
  const baseId = useId();
  const [status, setStatus] = useState<EmployeeStatus>(person.baseline.status);
  const [note, setNote] = useState(initialNote(person));
  const [recorderId, setRecorderId] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  async function submit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (recorderId === undefined) {
      setError(RECORDER_REQUIRED_MESSAGE);
      return;
    }
    setError(undefined);
    onSaveStateChange("saving");
    try {
      const outcome = await recordStatus(
        person.employeeId,
        statusBody(status, note, recorderId),
      );
      onSaveStateChange("idle");
      if (outcome.kind === "rejected") {
        setError(outcome.message);
        return;
      }
      onRecorded();
    } catch {
      onSaveStateChange("unconfirmed");
    }
  }

  const saving = saveState === "saving";
  return (
    <form className="grid gap-4" noValidate={true} onSubmit={submit}>
      <BaselineChangedNotice name={person.name} shown={baselineChanged} />
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
      <RecorderField
        id={`${baseId}-recorder`}
        onChange={setRecorderId}
        recorderId={recorderId}
        recorders={recorders}
      />
      <FormError
        id={`${baseId}-error`}
        message={formMessage(error, saveState)}
      />
      <DialogFooter>
        <DialogClose asChild={true}>
          <Button disabled={saving} type="button" variant="outline">
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
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const baselineEventId = person.baseline.event?.id ?? NO_BASELINE_EVENT;
  const [openedOn, setOpenedOn] = useState(baselineEventId);
  const title = `${OPEN_TEXT} for ${person.name}`;
  return (
    <Dialog
      onOpenChange={(next): void => {
        if (saveState !== "saving") {
          setOpenedOn(baselineEventId);
          setSaveState("idle");
          setOpen(next);
        }
      }}
      open={open}
    >
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
        {/* A reload under an open form (a status taking effect, the day rolling over) can change the
            person's status; keying by it starts the form over, so a save never builds on an old one.
            Only an idle form names the change: while saving it is this save's own and the dialog is
            about to close, and after an unconfirmed save the warning already says to check it. */}
        <StatusForm
          baselineChanged={saveState === "idle" && openedOn !== baselineEventId}
          key={baselineEventId}
          onRecorded={(): void => setOpen(false)}
          onSaveStateChange={setSaveState}
          person={person}
          recorders={recorders}
          recordStatus={recordStatus}
          saveState={saveState}
        />
      </DialogContent>
    </Dialog>
  );
}
