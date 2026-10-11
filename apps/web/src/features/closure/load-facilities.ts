import { notFound } from "@tanstack/react-router";
import { api } from "../../lib/api";
import { parseFacilityId } from "./facility-id";

const HTTP_NOT_FOUND = 404;

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

/** The personnel page reads the facility for its name and time zone beside the roster itself. */
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
  const [facility, result] = await Promise.all([
    loadFacility({ facilityId, signal }),
    api.api.facilities({ id }).personnel.get({ fetch: { signal } }),
  ]);
  if (result.error === null) {
    return { facility, personnel: result.data };
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
