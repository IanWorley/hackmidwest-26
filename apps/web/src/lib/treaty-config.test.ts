import { treaty } from "@elysiajs/eden";
import type { App } from "@hackmidwest/api/contract";
import { expect, it } from "vitest";
import { TREATY_CONFIG } from "./treaty-config";

const DECIDE_BY = "2026-10-11T10:00:00.000Z";

it("keeps date strings from the API as the strings the contract types them as", async () => {
  const client = treaty<App>("http://api.test", {
    ...TREATY_CONFIG,
    fetcher: Object.assign(
      () => Promise.resolve(Response.json({ decideBy: DECIDE_BY })),
      { preconnect: () => undefined },
    ),
  });

  const { data } = await client.api
    .facilities({ id: 1 })
    .recommendations.latest.get();

  expect([data?.decideBy, typeof data?.decideBy]).toEqual([
    DECIDE_BY,
    "string",
  ]);
});
