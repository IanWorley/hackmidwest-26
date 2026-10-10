import { treaty } from "@elysiajs/eden";
import type { App } from "@hackmidwest/api/contract";
import { readWebConfig } from "../config";

const config = readWebConfig({ apiBaseUrl: import.meta.env.VITE_API_BASE_URL });

// The only server import is erased. No API factory or Drizzle value reaches this module.
export const api = treaty<App>(config.apiBaseUrl);
