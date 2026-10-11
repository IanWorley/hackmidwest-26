import { createTestDatabase } from "@hackmidwest/db/testing";
import { expect, it } from "vitest";
import { createApp } from "../app";
import { makeNwpsClient } from "../clients/nwps";
import { makeNwsClient } from "../clients/nws";
import { makeOpenMeteoClient } from "../clients/open-meteo";
import { createApiRuntime } from "../runtime";
import { FLOOD_LIVE_PATH } from "./flood-live";

const REQUEST_ORIGIN = "http://api.test";
const WEB_ORIGIN = "http://web.test";
const HTTP_UNPROCESSABLE = 422;

it("rejects a gauge that is not an NWPS location id before calling any client", async () => {
  const store = await createTestDatabase();
  const runtime = createApiRuntime(store.db, {
    nws: makeNwsClient({ userAgent: "flood test, never sent" }),
    nwps: makeNwpsClient(() => Promise.reject(new Error("NWPS called"))),
    openMeteo: makeOpenMeteoClient(),
  });
  try {
    const app = createApp({
      runRequest: runtime.runRequest,
      webOrigin: WEB_ORIGIN,
    });
    const response = await app.handle(
      new Request(
        new URL(
          `${FLOOD_LIVE_PATH}?lat=39.0997&lon=-94.5786&gauge=kcdm7`,
          REQUEST_ORIGIN,
        ),
      ),
    );

    expect(response.status).toBe(HTTP_UNPROCESSABLE);
  } finally {
    try {
      await runtime.dispose();
    } finally {
      store.close();
    }
  }
});
