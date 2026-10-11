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

/** The API's own 422 and 404 messages are written for people, so the form shows them as-is. */
export async function recordEmployeeStatus(
  employeeId: number,
  body: StatusBody,
): Promise<RecordOutcome> {
  const result = await api.api.employees({ id: employeeId }).status.post(body);
  if (result.error === null) {
    return { kind: "recorded" };
  }
  if (
    result.error.status === HTTP_UNPROCESSABLE_ENTITY ||
    result.error.status === HTTP_NOT_FOUND
  ) {
    return { kind: "rejected", message: result.error.value.message };
  }
  return { kind: "rejected", message: SAVE_FAILED_MESSAGE };
}
