import { treaty } from "@elysiajs/eden";
import type { App } from "@hackmidwest/api/contract";
import { readWebConfig } from "../config";
import { TREATY_CONFIG } from "./treaty-config";

const config = readWebConfig(import.meta.env);

// The only server import is erased. No API factory or Drizzle value reaches this module.
export const api = treaty<App>(config.apiBaseUrl, TREATY_CONFIG);
