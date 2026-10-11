import { t } from "elysia";

// Ordered least to most disruptive, so a higher index is a stronger response.
export const POSTURES = [
  "normal",
  "delayed_arrival",
  "early_dismissal",
  "unscheduled_telework",
  "full_closure",
] as const;

export type Posture = (typeof POSTURES)[number];

export const postureSchema = t.UnionEnum(POSTURES);
