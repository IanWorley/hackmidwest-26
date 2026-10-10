# Architecture

## Shape

Four Bun workspaces:

- `packages/db` (`@hackmidwest/db`) owns persistence: Drizzle tables, the libSQL connection
  (`@hackmidwest/db/connection`), committed migrations, the seed, and the `createTestDatabase()` fixture
  (`@hackmidwest/db/testing`). The main export carries only tables and types, so importing a table never loads the
  connection. It has no HTTP
  dependency. It ships TypeScript source; Bun and Vitest load it directly, with no build step.
- `apps/api` owns HTTP: Elysia features and the TypeBox validators derived from `@hackmidwest/db` tables.
  Feature work runs as [Effect](https://effect.website) programs; Elysia stays the HTTP layer.
- `apps/agent-api` (`@hackmidwest/agent-api`) is a second, independent Elysia backend for agent and AI callers, on
  `AGENT_API_PORT`. It follows the API's shape (its own `config.ts`, `runtime.ts`, `app.ts`, `index.ts`, and
  `features/`), but shares no code with it. It never opens the database: features read tasks from `apps/api` over
  HTTP through the `TasksApi` service, an Eden client typed by the same `@hackmidwest/api/contract` the web uses
  (`TASKS_API_URL`). So `apps/api` stays the only SQLite writer and owns every task rule. It has no CORS (no browser
  calls it) and no type contract (no client imports it yet). Today it serves `GET /health` and a placeholder
  `GET /tasks/summary`.
- `apps/web` is TanStack Start. It imports one thing from the API: the `App` **type**, via the
  `@hackmidwest/api/contract` export (types-only condition, so a runtime import cannot resolve).
  Biome rejects relative imports into any other workspace's source.

```
packages/db/src/schema.ts (Drizzle table + TASK_TITLE_LENGTH)
  └─ apps/api features/tasks.ts: createSchemaFactory({ typeboxInstance: t }) → validators, Elysia routes running Effect programs → App = ReturnType<typeof createApp>
       └─ treaty<App>() in web/lib/api.ts
            └─ route loader → Route.useLoaderData() → component props
```

Router loaders own data fetching and caching. TanStack Query is deliberately omitted until a feature needs
polling, optimistic updates, or shared client cache.

## Module boundaries

`bun run lint` runs dependency-cruiser with `.dependency-cruiser.ts` after Biome. It checks the graph of source
imports that survive compilation, so `import type` never counts and every rule means "at runtime, X must not load
Y". Build output under `dist/` is not scanned, but importing it still counts.

Every app except `apps/web` is a backend. The backend rules below match `apps/<any app but web>/`, so a new backend
is covered without editing them.

- `web-no-server-code`: nothing under `apps/web/src` may reach a backend app, `packages/db`, Drizzle, libSQL, Elysia, or
  `bun:*` through any chain of imports. The `App` type import from `@hackmidwest/api/contract` is erased, so it passes.
- `db-driver-only-in-client`: in every workspace, only `packages/db/src/client.ts` opens connections: `@libsql/*`,
  Drizzle's `libsql` and `bun-sqlite` adapters (which build their own client from a URL), `bun:sqlite`, or
  `node:sqlite`. Drizzle's migrators are allowed.
- `db-no-http`: `packages/db` never loads Elysia or an `@elysiajs/*` package. HTTP belongs in an app.
- `node-compatible-source`: backend and database source also runs on Node under Vitest, so only a backend's Bun entry
  point, `apps/<backend>/src/index.ts`, may load `bun` or `bun:*` modules.
- `api-only-entry-points-open-resources`: in a backend's `src`, only `index.ts` and tests may reach `config.ts` or the
  database connection (`@hackmidwest/db/connection`), however the import is written and even through another module.
- `apps-are-independent`: no app may load another app's code at runtime, even through a helper package. `App` type
  imports from `@hackmidwest/api/contract` (web and agent API) are erased, so they pass. Apps talk over HTTP.
- `agent-api-reads-tasks-over-http`: nothing under `apps/agent-api` may load `packages/db`, even through a helper
  package. Its features yield the `TasksApi` service instead.
- `api-db-fixture-only-in-tests`: in a backend's `src`, only `*.test.ts` files may reach the `@hackmidwest/db/testing`
  fixture, even through another module. That includes `index.ts`.

Biome adds the checks dependency-cruiser cannot see:

- The root `noRestrictedImports` patterns govern which specifiers any workspace may write, including type imports.
  No workspace may import another workspace's source or a `packages/*` folder by relative path, or anything through
  a `node_modules` path, so package exports are the only way in.
- `noUndeclaredDependencies` keeps each workspace to its `package.json`. Web does not declare `@hackmidwest/db`, so
  no `@hackmidwest/db` export resolves there, type imports included.
- `noProcessEnv` limits `process.env` to each backend's `src/index.ts` and `packages/db/scripts/`.
- `noRestrictedGlobals` bans the `Bun` global, including `Bun.env`, in the same files as `node-compatible-source`,
  and bans `fetch` in the web app so Eden stays the only HTTP client.

`test/module-boundaries.test.ts` runs the probe files in `test/boundary-probes.ts` through dependency-cruiser and
Biome with the real configuration, so a rule that silently stops matching, including a Biome override that replaces another, fails a test
instead of passing lint.

## Effect in the API

Request features are Effect programs. A program states the services it needs in its type, yields them, and
turns driver rejections into tagged errors:

```
listTasks(): Effect<Task[], TaskStorageError, Database>
```

- `Database` (`apps/api/src/runtime.ts`) is a `Context.Service` key for the `@hackmidwest/db` connection. It is a
  token, not a repository: SQL stays in the feature that owns it.
- `runtime.ts` is the one place services are provided and programs are run. `createApiRuntime(db)` builds a
  `ManagedRuntime` from `Layer.succeed(Database, db)`. `ApiServices` is derived from that layer, so a new service is
  added in one place. `runRequest` runs one complete program per request. Any failure or defect is logged and becomes
  a declared `500 { message: "Internal server error" }`, so Eden types it and no driver detail reaches a client.
- Routes declare the 500 response next to their success response. Feature-specific errors (a future 404 or 409)
  are recovered inside the program before `runRequest`'s fallback.
- The process and each test own the connection. The runtime borrows it: shutdown drains Elysia, disposes the
  runtime, then closes the connection.
- `@hackmidwest/db`, its `migrate` and `seed` scripts, and `config.ts` stay plain async TypeScript. They are tooling
  and shared storage, not request features, so `packages/db` has no Effect dependency.

## Lint policy

Biome is configured at three levels:

- `biome.strict.jsonc` sets each rule group, nursery included, to `"error"` and turns on the domains this
  stack uses (React, test, types, project, Drizzle, Playwright). A Biome upgrade's new rules are errors
  as soon as the version bumps. Group severities can only be strings, which can't carry exceptions, so
  this file holds none.
- `biome.jsonc` extends it. It sets rule options and lists every repo-wide exception with its reason.
  Exceptions include framework rules for Solid, Qwik, and Next that misread React, and Bundler-incompatible
  `useImportExtensions`.
- Each workspace's `biome.jsonc` has `"root": false, "extends": "//"` and only that workspace's exceptions,
  copied from `templates/biome/` (library, server app, web app).

Exceptions live in `linter.rules` or in narrowly scoped `overrides`. Repo-wide rule settings stay out of a
root `"**"` override, because an override from the root beats a workspace's `linter.rules` and would silently
cancel the workspace's choice.

Import boundaries split the same way. Every workspace gets the boundaries that hold for all of them from
the root, so a missing workspace config cannot drop them:

- No relative import into another workspace's `src`. Workspaces meet through package names, which keeps
  each `package.json` the one dependency graph.
- `noUndeclaredDependencies` enforces that graph, and dev dependencies are importable only from tests, test
  setup, and `*.config.ts` files.
- `noBunModules` keeps `bun` and `bun:*` modules out, so code runs under Vitest on Node. Each backend's entry
  point, `apps/<backend>/src/index.ts`, is the one exception in its workspace.

A workspace config adds rules specific to its kind. Server and library configs ban the `Bun` global in `src`,
and the web config bans `fetch`. Runtime bans that must follow subpaths and import chains, such as Elysia in web
or HTTP frameworks in `packages/db`, belong to dependency-cruiser. A workspace `patterns` list would replace the
root's `patterns` rather than add to them, so workspaces add import bans with `paths` only. A rule's options in
an override likewise replace that rule's options for the matched files.

A missing workspace config leaves the root policy in place, including the shared boundaries and every
dependency-cruiser rule. The workspace loses only its kind-specific globals bans. A nested
config without `"root": false` is a Biome error.

## Testing

Vitest runs on Node, so the API uses `@libsql/client/sqlite3` (works on Bun and Node) rather than `bun:sqlite`.
Each test opens a private `file::memory:` database, applies the real committed migrations, and closes it.
API tests call `app.handle(new Request(...))` — real validation and serialization, no ports.

## Tradeoffs accepted

- `packages/db` exports tables and limits, not request validators. Each API derives its own validators, so
  request shapes can differ per API while the CHECK constraint stays the shared floor. Move shared queries into
  the package only once two APIs duplicate them.
- libSQL's native dependency, in exchange for one SQLite driver across Bun runtime and Node tests.
- `VITE_API_BASE_URL` is baked in at build time and must be reachable from both browser and SSR.
- Effect inside Elysia, not Effect's own HTTP stack, in exchange for keeping the Eden contract and Drizzle-derived
  validators. `effect/http-api` would replace both and ship Effect in the web bundle.
- One generic 500 for every storage failure and defect, in exchange for no invented availability policy.
- Promise-backed Drizzle queries under `Effect.tryPromise`. Interruption cannot cancel a libSQL write, so request
  abort signals are not forwarded and inserts are never retried.
- The agent API copies the API's runtime and shutdown code (about 80 lines) instead of sharing a server package. Extract it
  once a third backend appears or the two copies need to change together.
- The agent API reads tasks over HTTP, not from SQLite, in exchange for one writer and one owner of task rules. Each
  agent read costs a network hop, and the agent API's task features fail when `apps/api` is down.
- Agent API tests stub `apps/api` with a real `node:http` server rather than passing Eden a `fetcher`, because Bun's
  `typeof fetch` requires a `preconnect` property and a stub would need a cast.
- `useExplicitType` is off because it has no allow-list. `useExplicitReturnType` stays on, and each workspace
  names the builders (Elysia app, Drizzle connection, TanStack router) whose inferred types are the contract.
- Nursery rules are errors, in exchange for upgrade churn. Biome is pinned exactly, so that churn lands only
  in a deliberate upgrade PR.
- Moving to Postgres changes table builders, the driver/client, migrations, and the test fixture — no dialect
  abstraction is built ahead of time.

## How this design was chosen

Four candidate designs were sketched in parallel (2× gpt-6-astra, 2× gpt-6.1-sol) and scored by a
gpt-6-astra cross-judge. Candidate 4 (API-owned database, two workspaces) won 22/25 at the time; the other three put the
database in a shared `packages/db`, which had a single consumer. Grafted in: two cached CI jobs (candidate 1),
a rejection test proving nothing is stored (candidate 2), and a seed idempotency test (candidate 3).

The lint policy came from two parallel candidates (gpt-6-astra, gpt-6.1-sol). Both listed every rule
explicitly in one root file of roughly 600 lines. Both used a schema-derived script to keep that list complete
and a workspace-coverage guard that ran before `lint`. The synthesis replaced the rule list with group
severities, which cover new rules without a list or script. It dropped the coverage guard because both
failure modes appeared to fail safe. Review found that the web boundary lived only in the web config, so
the cross-workspace ban moved to the root. From candidate 1 it took the per-kind templates, the root filename overrides
for tool configs, and keeping inferred builder types. From candidate 2 it took `useExplicitReturnType` with
per-workspace allow-lists rather than turning the rule off.

The database moved to `packages/db` once a second backend (the agent API) was planned, the extraction trigger
the original design named. Storage-only was chosen over exporting shared validators to keep HTTP rules per API.

Effect was chosen the same way as the original design: four candidates (2× gpt-6-astra, 2× gpt-6.1-sol) covering Effect inside Elysia
handlers, Effect HttpApi replacing Elysia and Eden, Effect owning config and process lifecycle, and an unconstrained
design. A gpt-6.1-sol cross-judge scored them. The minimal candidate (feature programs plus one sanitized `runRequest`)
won 27/30, with the `Database` service and `ManagedRuntime` grafted from the Elysia-handlers candidate. The HttpApi
and lifecycle candidates were rejected for scope: a third workspace, a 422→400 change, and an `@effect/platform-bun`
override, because `effect@4.0.3` is not published.

The agent API was chosen from two candidates (gpt-6-astra, gpt-6.1-sol): a self-contained app that copies the API's
runtime, and a shared `packages/http-server` that owns the runtime, port parsing, and shutdown for both backends. Both
converged on no storage, no CORS, and a health route. The self-contained app won because the shared package rewrote
the working API's 500 handling to save about 80 lines, against the "share once two APIs duplicate it" rule above.
Grafted from the shared-package candidate: backend lint rules that match every non-web app. Reading tasks over HTTP
from `apps/api`, rather than opening a second SQLite connection, was the owner's call after the first cut. Rejected from both: a
test that parses `verify.sh` and the root scripts to prove every app is listed, as more machinery than three apps need.
