import { TIMING_POLICY } from "./thresholds";
import { MS_PER_MINUTE, parseInstant } from "./zoned-time";

const STALE_LIMITS = {
  observations: TIMING_POLICY.observationStaleMinutes,
  forecast: TIMING_POLICY.forecastStaleMinutes,
  airQuality: TIMING_POLICY.airQualityStaleMinutes,
} as const;

type InputKind = keyof typeof STALE_LIMITS;

interface StaleInput {
  readonly input: InputKind;
  readonly ageMinutes: number;
  readonly limitMinutes: number;
}

function staleInputs(
  stamps: readonly { readonly input: InputKind; readonly asOf: string }[],
  now: string,
): StaleInput[] {
  const nowAt = parseInstant(now);
  return stamps.flatMap(({ input, asOf }) => {
    const ageMinutes = Math.floor((nowAt - parseInstant(asOf)) / MS_PER_MINUTE);
    const limitMinutes = STALE_LIMITS[input].value;
    if (ageMinutes <= limitMinutes) {
      return [];
    }
    return [{ input, ageMinutes, limitMinutes }];
  });
}

export type { InputKind, StaleInput };
export { staleInputs };
