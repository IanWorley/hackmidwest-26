import { type BoundaryProbe, IMPORT_PROCESS } from "./probe-fixtures";

/** Opt-in integration tests may read credentials from the environment; unit tests still may not. */
export const API_INTEGRATION_TEST_LINT_PROBES: readonly BoundaryProbe[] = [
  {
    behavior: "an API integration test may read process.env",
    files: {
      "apps/api/src/clients/probe.integration.test.ts": `${IMPORT_PROCESS}export const probe = process.env.NWS_USER_AGENT;\n`,
    },
    violatedRules: [],
  },
  {
    behavior: "an API unit test cannot read process.env",
    files: {
      "apps/api/src/clients/probe.test.ts": `${IMPORT_PROCESS}export const probe = process.env.NWS_USER_AGENT;\n`,
    },
    violatedRules: ["style/noProcessEnv"],
  },
];
