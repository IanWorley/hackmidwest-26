import { notFound } from "@tanstack/react-router";
import { api } from "../../lib/api";

const HTTP_NOT_FOUND = 404;
const HTTP_UNPROCESSABLE = 422;

/** Routes receive successful domain data; Eden error envelopes stop at this boundary. */
export async function loadFacilities({ signal }: { signal: AbortSignal }) {
  const result = await api.api.facilities.get({ fetch: { signal } });
  if (result.error !== null) {
    throw new Error("Unable to load facilities", { cause: result.error.value });
  }
  return result.data;
}

/** An id the API rejects as malformed names no facility either, so both read as not found. */
export async function loadFacility({
  id,
  signal,
}: {
  id: number;
  signal: AbortSignal;
}) {
  const result = await api.api.facilities({ id }).get({ fetch: { signal } });
  if (result.error === null) {
    return result.data;
  }
  if (
    result.error.status === HTTP_NOT_FOUND ||
    result.error.status === HTTP_UNPROCESSABLE
  ) {
    throw notFound();
  }
  throw new Error("Unable to load the facility", {
    cause: result.error.value,
  });
}

export type Facilities = Awaited<ReturnType<typeof loadFacilities>>;
export type Facility = Facilities[number];
export type Hazard = Facility["hazards"][number];
