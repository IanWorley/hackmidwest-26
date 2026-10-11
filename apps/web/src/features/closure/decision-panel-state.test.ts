import { expect, it } from "vitest";
import { panelReducer } from "./decision-panel-state";

it.each([{ type: "choose", action: "defer" }, { type: "cancel" }] as const)(
  "a submit in flight ignores %j",
  (event) => {
    expect(
      panelReducer({ status: "submitting", action: "accept" }, event),
    ).toEqual({ status: "submitting", action: "accept" });
  },
);
