import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const MIN_URL_LENGTH = 1;
const HTTP_PROTOCOL = "http:";
const HTTPS_PROTOCOL = "https:";
const ORIGIN_PATH = "/";
const PublicApiUrlSchema = Type.String({ minLength: MIN_URL_LENGTH });

interface WebConfig {
  readonly apiBaseUrl: string;
}

/** Accept a public HTTP origin usable by both Start SSR and browser navigation. */
export function readWebConfig({
  apiBaseUrl,
}: {
  apiBaseUrl: unknown;
}): WebConfig {
  if (!Value.Check(PublicApiUrlSchema, apiBaseUrl)) {
    throw new Error("VITE_API_BASE_URL must be configured");
  }
  const url = new URL(apiBaseUrl);
  if (
    (url.protocol !== HTTP_PROTOCOL && url.protocol !== HTTPS_PROTOCOL) ||
    url.pathname !== ORIGIN_PATH ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "VITE_API_BASE_URL must be an HTTP(S) origin without credentials or a path",
    );
  }
  return { apiBaseUrl: url.origin };
}
