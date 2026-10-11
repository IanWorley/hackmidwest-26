import { type Static, t } from "elysia";
import {
  AlertCertaintySchema,
  AlertMessageTypeSchema,
  AlertSeveritySchema,
  AlertUrgencySchema,
  type ForecastPeriod,
  hazardWindow,
  NullableNumber,
  NullableString,
  type NwsAlert,
  QuantitySchema,
} from "./nws-model";

const PointsResponse = t.Object({
  properties: t.Object({
    gridId: t.String(),
    gridX: t.Integer(),
    gridY: t.Integer(),
    forecast: t.String(),
    forecastHourly: t.String(),
    observationStations: t.String(),
  }),
});

const ForecastPeriodWire = t.Object({
  startTime: t.String(),
  endTime: t.String(),
  isDaytime: t.Boolean(),
  temperature: NullableNumber,
  temperatureUnit: NullableString,
  windSpeed: NullableString,
  windDirection: NullableString,
  shortForecast: NullableString,
  probabilityOfPrecipitation: t.Object({ value: NullableNumber }),
});

const ForecastResponse = t.Object({
  properties: t.Object({ periods: t.Array(ForecastPeriodWire) }),
});

const AlertWire = t.Object({
  id: t.String(),
  event: t.String(),
  headline: NullableString,
  severity: AlertSeveritySchema,
  certainty: AlertCertaintySchema,
  urgency: AlertUrgencySchema,
  messageType: AlertMessageTypeSchema,
  references: t.Array(t.Object({ identifier: t.String() })),
  effective: t.String(),
  onset: NullableString,
  ends: NullableString,
  expires: t.String(),
});

const AlertsResponse = t.Object({
  features: t.Array(t.Object({ properties: AlertWire })),
});

const StationsResponse = t.Object({
  features: t.Array(
    t.Object({
      properties: t.Object({ stationIdentifier: t.String() }),
    }),
  ),
});

const ObservationResponse = t.Object({
  properties: t.Object({
    "@id": t.String(),
    timestamp: t.String(),
    temperature: QuantitySchema,
    windSpeed: QuantitySchema,
    windGust: QuantitySchema,
    visibility: QuantitySchema,
  }),
});

type GridPoint = Static<typeof PointsResponse>["properties"];

function toForecastPeriod(
  period: Static<typeof ForecastPeriodWire>,
): ForecastPeriod {
  return {
    startTime: period.startTime,
    endTime: period.endTime,
    isDaytime: period.isDaytime,
    temperature: period.temperature,
    temperatureUnit: period.temperatureUnit,
    windSpeed: period.windSpeed,
    windDirection: period.windDirection,
    shortForecast: period.shortForecast,
    probabilityOfPrecipitation: period.probabilityOfPrecipitation.value,
  };
}

function toNwsAlert(alert: Static<typeof AlertWire>): NwsAlert {
  return {
    id: alert.id,
    event: alert.event,
    headline: alert.headline,
    severity: alert.severity,
    certainty: alert.certainty,
    urgency: alert.urgency,
    messageType: alert.messageType,
    references: alert.references.map(({ identifier }) => identifier),
    hazardWindow: hazardWindow(alert),
  };
}

export type { GridPoint };
export {
  AlertsResponse,
  ForecastResponse,
  ObservationResponse,
  PointsResponse,
  StationsResponse,
  toForecastPeriod,
  toNwsAlert,
};
