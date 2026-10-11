export const APP_NAME = "Hack Midwest";

/** Every page titles itself the same way, so tabs and history read alike. */
export function pageTitle(page: string): string {
  return `${page} · ${APP_NAME}`;
}
