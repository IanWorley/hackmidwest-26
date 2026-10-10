# Architecture

## Shape

Three Bun workspaces:

- `packages/db` (`@hackmidwest/db`) owns persistence: Drizzle tables, the libSQL connection, committed
  migrations, the seed, and the `createTestDatabase()` fixture (`@hackmidwest/db/testing`). It has no HTTP
  dependency. It ships TypeScript source; Bun and Vitest load it directly, with no build step.
- `apps/api` owns HTTP: Elysia features and the TypeBox validators derived from `@hackmidwest/db` tables.
  Feature work runs as [Effect](https://effect.website) programs; Elysia stays the HTTP layer.
- `apps/web` is TanStack Start. It imports one thing from the API: the `App` **type**, via the
  `@hackmidwest/api/contract` export (types-only condition, so a runtime import cannot resolve).
  Biome also rejects relative imports into API source and any import of `@hackmidwest/db`.

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

- `web-no-server-code`: nothing under `apps/web/src` may reach the API, `packages/db`, Drizzle, libSQL, Elysia, or
  `bun:*` through any chain of imports. The `App` type import from `@hackmidwest/api/contract` is erased, so it passes.
- `db-driver-only-in-client`: in every workspace, only `packages/db/src/client.ts` opens connections: `@libsql/*`,
  Drizzle's `libsql` and `bun-sqlite` adapters (which build their own client from a URL), `bun:sqlite`, or
  `node:sqlite`. Drizzle's migrators are allowed.
- `node-compatible-source`: API and database source also runs on Node under Vitest, so only the Bun entry point
  `apps/api/src/index.ts` may load `bun` or `bun:*` modules.
- `api-config-only-in-entry-point`: in `apps/api/src`, only `index.ts` and tests may reach `config.ts`, even through
  another module.
- `api-db-fixture-only-in-tests`: in `apps/api/src`, only `*.test.ts` files may reach the `@hackmidwest/db/testing`
  fixture, even through another module. That includes `index.ts`.

Biome adds the checks dependency-cruiser cannot see:

- Its `noRestrictedImports` overrides govern which specifiers web may write, including type imports, and stop API
  code other than `src/index.ts` from importing `openDatabase`. Apps may not import `packages/db` source files by
  relative path, so the package's exports are the only way in. Features import tables and the `Database` type from
  the same package, so this is a name check, not a module check.
- `noProcessEnv` limits `process.env` to `apps/api/src/index.ts` and `packages/db/scripts/`.
- `noRestrictedGlobals` bans the `Bun` global, including `Bun.env`, in the same files as `node-compatible-source`.

`test/module-boundaries.test.ts` cruises small probe files against the real rule set, so a rule that silently stops
matching fails a test instead of passing lint.

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
- Moving to Postgres changes table builders, the driver/client, migrations, and the test fixture — no dialect
  abstraction is built ahead of time.

## How this design was chosen

Four candidate designs were sketched in parallel (2× gpt-6-astra, 2× gpt-6.1-sol) and scored by a
gpt-6-astra cross-judge. Candidate 4 (API-owned database, two workspaces) won 22/25 at the time; the other three put the
database in a shared `packages/db`, which had a single consumer. Grafted in: two cached CI jobs (candidate 1),
a rejection test proving nothing is stored (candidate 2), and a seed idempotency test (candidate 3).

The database moved to `packages/db` once a second backend (the agent API) was planned, the extraction trigger
the original design named. Storage-only was chosen over exporting shared validators to keep HTTP rules per API.

Effect was chosen the same way as the original design: four candidates (2× gpt-6-astra, 2× gpt-6.1-sol) covering Effect inside Elysia
handlers, Effect HttpApi replacing Elysia and Eden, Effect owning config and process lifecycle, and an unconstrained
design. A gpt-6.1-sol cross-judge scored them. The minimal candidate (feature programs plus one sanitized `runRequest`)
won 27/30, with the `Database` service and `ManagedRuntime` grafted from the Elysia-handlers candidate. The HttpApi
and lifecycle candidates were rejected for scope: a third workspace, a 422→400 change, and an `@effect/platform-bun`
override, because `effect@4.0.3` is not published.
