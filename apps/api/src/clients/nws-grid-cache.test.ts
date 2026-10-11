import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import { expect, it } from "vitest";
import {
  clientFor,
  emptyForecastResponse,
  KANSAS_CITY,
  pointsResponse,
} from "./nws-test-client";

const HTTP_NOT_FOUND = 404;

it("looks up a point's grid again once the cached mapping is a day old", async () => {
  const { client, sent } = clientFor([
    pointsResponse(),
    emptyForecastResponse(),
    emptyForecastResponse(),
    pointsResponse(),
    emptyForecastResponse(),
  ]);

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* client.forecast(KANSAS_CITY);
      yield* client.forecast(KANSAS_CITY);
      yield* TestClock.adjust(Duration.hours(24));
      yield* client.forecast(KANSAS_CITY);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  expect(sent.map(({ url }) => url)).toEqual([
    "http://nws.test/points/39.0997,-94.5786",
    "http://nws.test/gridpoints/EAX/44,51/forecast",
    "http://nws.test/gridpoints/EAX/44,51/forecast",
    "http://nws.test/points/39.0997,-94.5786",
    "http://nws.test/gridpoints/EAX/44,51/forecast",
  ]);
});

it("shares one /points request between concurrent pulls of the same point", async () => {
  const { client, sent } = clientFor([
    pointsResponse(),
    emptyForecastResponse(),
    emptyForecastResponse(),
  ]);

  await Effect.runPromise(
    Effect.all(
      [client.forecast(KANSAS_CITY), client.hourlyForecast(KANSAS_CITY)],
      {
        concurrency: "unbounded",
      },
    ),
  );

  expect(sent.map(({ url }) => url).sort((a, b) => a.localeCompare(b))).toEqual(
    [
      "http://nws.test/gridpoints/EAX/44,51/forecast",
      "http://nws.test/gridpoints/EAX/44,51/forecast/hourly",
      "http://nws.test/points/39.0997,-94.5786",
    ],
  );
});

it("looks up a point again after a failed lookup instead of caching the failure", async () => {
  const { client, sent } = clientFor([
    new Response(null, { status: HTTP_NOT_FOUND }),
    pointsResponse(),
    emptyForecastResponse(),
  ]);

  const first = await Effect.runPromise(
    Effect.exit(client.forecast(KANSAS_CITY)),
  );
  const second = await Effect.runPromise(client.forecast(KANSAS_CITY));

  expect([first._tag, second.periods, sent.map(({ url }) => url)]).toEqual([
    "Failure",
    [],
    [
      "http://nws.test/points/39.0997,-94.5786",
      "http://nws.test/points/39.0997,-94.5786",
      "http://nws.test/gridpoints/EAX/44,51/forecast",
    ],
  ]);
});
