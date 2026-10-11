import type { Hazard } from "@hackmidwest/db";
import { THRESHOLDS } from "./thresholds";

type CutoffName = {
  [H in Hazard]: keyof (typeof THRESHOLDS)[H]["cutoffs"];
}[Hazard];

function isCutoffName(hazard: Hazard, name: string): name is CutoffName {
  return Object.hasOwn(THRESHOLDS[hazard].cutoffs, name);
}

export type { CutoffName };
export { isCutoffName };
