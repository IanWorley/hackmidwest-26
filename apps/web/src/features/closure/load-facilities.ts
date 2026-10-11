import { notFound } from "@tanstack/react-router";
import { api } from "../../lib/api";
import { parseFacilityId } from "./facility-id";

const HTTP_NOT_FOUND = 404;

type FacilityDayCall = ReturnType<typeof api.api.facilities>["facility-date"];
type FacilityDay = NonNullable<
  Awaited<ReturnType<FacilityDayCall["get"]>>["data"]
>;

/** Routes receive successful domain data; Eden error envelopes stop at this boundary. */
export async function loadFacilities({ signal }: { signal: AbortSignal }) {
  const result = await api.api.facilities.get({ fetch: { signal } });
  if (result.error !== null) {
    throw new Error("Unable to load facilities", { cause: result.error.value });
  }
  return result.data;
}

/** A path segment that is not a facility id names no facility, so it reads as not found. */
export async function loadFacility({
  facilityId,
  signal,
}: {
  facilityId: string;
  signal: AbortSignal;
}) {
  const id = parseFacilityId(facilityId);
  if (id === undefined) {
    throw notFound();
  }
  const result = await api.api.facilities({ id }).get({ fetch: { signal } });
  if (result.error === null) {
    return result.data;
  }
  if (result.error.status === HTTP_NOT_FOUND) {
    throw notFound();
  }
  throw new Error("Unable to load the facility", {
    cause: result.error.value,
  });
}

/** The facility day by the engine's rule, and when it rolls over, so a screen knows when to reload. */
export async function loadFacilityDay(
  facilityId: number,
  signal: AbortSignal,
): Promise<FacilityDay> {
  const result = await api.api
    .facilities({ id: facilityId })
    ["facility-date"].get({ fetch: { signal } });
  if (result.error === null) {
    return result.data;
  }
  if (result.error.status === HTTP_NOT_FOUND) {
    throw notFound();
  }
  throw new Error("Unable to load the facility's current day", {
    cause: result.error.value,
  });
}

/** The personnel page reads the facility for its name and time zone, and its day's rollover, beside the roster itself. */
export async function loadFacilityPersonnel({
  facilityId,
  signal,
}: {
  facilityId: string;
  signal: AbortSignal;
}) {
  const id = parseFacilityId(facilityId);
  if (id === undefined) {
    throw notFound();
  }
  const [facility, result, facilityDay] = await Promise.all([
    loadFacility({ facilityId, signal }),
    api.api.facilities({ id }).personnel.get({ fetch: { signal } }),
    loadFacilityDay(id, signal),
  ]);
  if (result.error === null) {
    return {
      facility,
      personnel: result.data,
      rollsOverAt: facilityDay.rollsOverAt,
    };
  }
  if (result.error.status === HTTP_NOT_FOUND) {
    throw notFound();
  }
  throw new Error("Unable to load the facility's personnel", {
    cause: result.error.value,
  });
}

export type Facilities = Awaited<ReturnType<typeof loadFacilities>>;
export type Facility = Facilities[number];
export type Hazard = Facility["hazards"][number];
