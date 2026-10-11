import { facilities, HAZARDS } from "@hackmidwest/db";
import { createSchemaFactory } from "drizzle-typebox";
import { type Static, t } from "elysia";
import type { FloodCategory } from "../../clients/nwps";
import { ForecastPeriodSchema, NwsAlertSchema } from "../../clients/nws-model";
import { ReadingSchema } from "./readings";

const { createSelectSchema } = createSchemaFactory({ typeboxInstance: t });
const facilityColumns = createSelectSchema(facilities).properties;

const CLOSED = { additionalProperties: false } as const;

const StageAtSchema = t.Object(
  { stageFt: t.Number(), validTime: t.String() },
  CLOSED,
);

// A Record keyed by t.UnionEnum loses its keys under t.Partial and accepts any object, so the keys are spelled out.
const FloodStagesFtSchema = t.Partial(
  t.Object({
    action: t.Number(),
    minor: t.Number(),
    moderate: t.Number(),
    major: t.Number(),
  } satisfies Record<FloodCategory, unknown>),
  CLOSED,
);

/** Plain JSON with ISO-8601 instants, so a stored input replays through `Value.Parse`. */
const EngineInputSchema = t.Object(
  {
    /** The evaluation instant. The engine never reads the clock. */
    now: t.String(),
    facility: t.Object(
      {
        timezone: facilityColumns.timezone,
        opensAt: facilityColumns.opensAt,
        closesAt: facilityColumns.closesAt,
        arrivalWindowStart: facilityColumns.arrivalWindowStart,
        arrivalWindowEnd: facilityColumns.arrivalWindowEnd,
        typicalCommuteMinutes: facilityColumns.typicalCommuteMinutes,
        roadClass: facilityColumns.roadClass,
        decisionDeadline: facilityColumns.decisionDeadline,
        hazards: t.Array(t.UnionEnum(HAZARDS)),
      },
      CLOSED,
    ),
    alerts: t.Object(
      { asOf: t.String(), items: t.Array(NwsAlertSchema) },
      CLOSED,
    ),
    readings: t.Array(ReadingSchema),
    forecast: t.Union([
      t.Object(
        {
          asOf: t.String(),
          rawRef: t.String(),
          periods: t.Array(ForecastPeriodSchema),
        },
        CLOSED,
      ),
      t.Null(),
    ]),
    /** Null when the facility has no river gauge, so flood rests on alerts alone. */
    gauge: t.Union([
      t.Object(
        {
          rawRef: t.String(),
          asOf: t.String(),
          /** Only the categories this gauge defines a stage for. */
          floodStagesFt: FloodStagesFtSchema,
          observed: t.Union([StageAtSchema, t.Null()]),
          forecast: t.Array(StageAtSchema),
        },
        CLOSED,
      ),
      t.Null(),
    ]),
  },
  CLOSED,
);

type EngineInput = Static<typeof EngineInputSchema>;

export type { EngineInput };
export { CLOSED, EngineInputSchema };
