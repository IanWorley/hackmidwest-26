import { api } from "../../lib/api";
import { SAVE_FAILED_MESSAGE } from "./status-messages";

const HTTP_UNPROCESSABLE_ENTITY = 422;
const HTTP_NOT_FOUND = 404;

export type StatusBody = Parameters<
  ReturnType<typeof api.api.employees>["status"]["post"]
>[0];
export type EmployeeStatus = StatusBody["status"];

export type RecordOutcome =
  | { readonly kind: "recorded" }
  | { readonly kind: "rejected"; readonly message: string };

export type RecordStatus = (
  employeeId: number,
  body: StatusBody,
) => Promise<RecordOutcome>;

/**
 * The API's own 422 and 404 messages are written for people, so the form shows them as-is.
 *
 * Eden answers a dropped connection with a synthetic 503 and no response, and the server may
 * have stored the status before the connection dropped. That case throws, like any other
 * unanswered request, so the caller reconciles against what was stored instead of offering a
 * retry that would append a duplicate add-only event.
 */
export async function recordEmployeeStatus(
  employeeId: number,
  body: StatusBody,
): Promise<RecordOutcome> {
  const result = await api.api.employees({ id: employeeId }).status.post(body);
  if (result.error === null) {
    return { kind: "recorded" };
  }
  if (result.response === undefined) {
    throw new Error("The status save got no response", {
      cause: result.error.value,
    });
  }
  if (
    result.error.status === HTTP_UNPROCESSABLE_ENTITY ||
    result.error.status === HTTP_NOT_FOUND
  ) {
    return { kind: "rejected", message: result.error.value.message };
  }
  return { kind: "rejected", message: SAVE_FAILED_MESSAGE };
}
