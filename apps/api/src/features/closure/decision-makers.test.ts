import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { expect, it } from "vitest";
import { createApp } from "../../app";
import { makeNwsClient } from "../../clients/nws";
import { makeOpenMeteoClient } from "../../clients/open-meteo";
import { createApiRuntime, HTTP_OK } from "../../runtime";
import { DECISION_MAKERS_PATH } from "./decision-makers";

const REQUEST_ORIGIN = "http://api.test";
const WEB_ORIGIN = "http://web.test";

it("lists decision makers by name with their roles and no email", async () => {
  const store = await createTestDatabaseWithDemoFacilities();
  const runtime = createApiRuntime(store.db, {
    nws: makeNwsClient({ userAgent: "decision makers test, never sent" }),
    openMeteo: makeOpenMeteoClient(),
  });
  try {
    const app = createApp({
      runRequest: runtime.runRequest,
      webOrigin: WEB_ORIGIN,
    });
    const response = await app.handle(
      new Request(new URL(DECISION_MAKERS_PATH, REQUEST_ORIGIN)),
    );

    expect(response.status).toBe(HTTP_OK);
    expect(await response.json()).toEqual([
      { id: 1, name: "Dana Whitfield", role: "County Executive Director" },
      {
        id: 5,
        name: "Grace Lindqvist",
        role: "Deputy State Executive Director",
      },
      { id: 2, name: "Marcus Oyelaran", role: "State Administrative Officer" },
      { id: 3, name: "Priya Raman", role: "District Conservationist" },
      { id: 4, name: "Tomas Ibarra", role: "Facility Operations Manager" },
    ]);
  } finally {
    try {
      await runtime.dispose();
    } finally {
      store.close();
    }
  }
});
