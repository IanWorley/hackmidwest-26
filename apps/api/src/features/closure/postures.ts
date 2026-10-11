import { POSTURES } from "@hackmidwest/db";
import { t } from "elysia";

export type { Posture } from "@hackmidwest/db";

export const postureSchema = t.UnionEnum(POSTURES);
