# Architecture

## Shape

Three Bun workspaces:

- `packages/db` (`@hackmidwest/db`) owns persistence: Drizzle tables, the libSQL connection, committed
  migrations, the seed, and the `createTestDatabase()` fixture (`@hackmidwest/db/testing`). It has no HTTP
  dependency. It ships TypeScript source; Bun and Vitest load it directly, with no build step.
- `apps/api` owns HTTP: Elysia features and the TypeBox validators derived from `@hackmidwest/db` tables.
- `apps/web` is TanStack Start. It imports one thing from the API: the `App` **type**, via the
  `@hackmidwest/api/contract` export (types-only condition, so a runtime import cannot resolve).
  Biome also rejects relative imports into API source and any import of `@hackmidwest/db`.

```
packages/db/src/schema.ts (Drizzle table + TASK_TITLE_LENGTH)
  └─ apps/api features/tasks.ts: createSchemaFactory({ typeboxInstance: t }) → validators, Elysia routes → App = ReturnType<typeof createApp>
       └─ treaty<App>() in web/lib/api.ts
            └─ route loader → Route.useLoaderData() → component props
```

Router loaders own data fetching and caching. TanStack Query is deliberately omitted until a feature needs
polling, optimistic updates, or shared client cache.

## Module boundaries

`bun run lint` runs dependency-cruiser with `.dependency-cruiser.ts` after Biome. It checks the graph of source
imports that survive compilation (build output under `dist/` is excluded), so `import type` never counts and every
rule means "at runtime, X must not load Y":

- `web-no-server-code`: nothing under `apps/web/src` may reach the API, `packages/db`, Drizzle, libSQL, Elysia, or
  `bun:*` through any chain of imports. The `App` type import from `@hackmidwest/api/contract` is erased, so it passes.
- `db-driver-only-in-client`: in every workspace, only `packages/db/src/client.ts` opens connections: `@libsql/*`,
  Drizzle's `libsql` and `bun-sqlite` adapters (which build their own client from a URL), or `bun:sqlite`. Drizzle's
  migrators are allowed.
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
- `noRestrictedGlobals` bans `Bun`, including `Bun.env`, in API and database source, which also run under Vitest on
  Node. `apps/api/src/index.ts` is exempt: it is the Bun entry point and never runs under Vitest.

`test/module-boundaries.test.ts` cruises small probe files against the real rule set, so a rule that silently stops
matching fails a test instead of passing lint.

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
- Moving to Postgres changes table builders, the driver/client, migrations, and the test fixture — no dialect
  abstraction is built ahead of time.

## How this design was chosen

Four candidate designs were sketched in parallel (2× gpt-6-astra, 2× gpt-6.1-sol) and scored by a
gpt-6-astra cross-judge. Candidate 4 (API-owned database, two workspaces) won 22/25 at the time; the other three put the
database in a shared `packages/db`, which had a single consumer. Grafted in: two cached CI jobs (candidate 1),
a rejection test proving nothing is stored (candidate 2), and a seed idempotency test (candidate 3).

The database moved to `packages/db` once a second backend (the agent API) was planned, the extraction trigger
the original design named. Storage-only was chosen over exporting shared validators to keep HTTP rules per API.
