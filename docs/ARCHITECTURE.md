# Architecture

## Shape

Two Bun workspaces, no shared `packages/*`:

- `apps/api` owns everything server-side: Drizzle tables, derived TypeBox validators, the libSQL connection,
  committed migrations, and the Elysia features. It is the only process that touches SQLite.
- `apps/web` is TanStack Start. It imports one thing from the API: the `App` **type**, via the
  `@hackmidwest/api/contract` export (types-only condition, so a runtime import cannot resolve).
  Biome also rejects relative imports into API source.

```
schema.ts (Drizzle table)
  └─ createSchemaFactory({ typeboxInstance: t }) → request/response validators
       └─ features/tasks.ts (Elysia routes) → App = ReturnType<typeof createApp>
            └─ treaty<App>() in web/lib/api.ts
                 └─ route loader → Route.useLoaderData() → component props
```

Router loaders own data fetching and caching. TanStack Query is deliberately omitted until a feature needs
polling, optimistic updates, or shared client cache.

## Testing

Vitest runs on Node, so the API uses `@libsql/client/sqlite3` (works on Bun and Node) rather than `bun:sqlite`.
Each test opens a private `file::memory:` database, applies the real committed migrations, and closes it.
API tests call `app.handle(new Request(...))` — real validation and serialization, no ports.

## Tradeoffs accepted

- API owns the database instead of a `packages/db`, in exchange for one migration owner and fewer packages.
  Extract a package only when a second process needs the database.
- libSQL's native dependency, in exchange for one SQLite driver across Bun runtime and Node tests.
- `VITE_API_BASE_URL` is baked in at build time and must be reachable from both browser and SSR.
- Moving to Postgres changes table builders, the driver/client, migrations, and the test fixture — no dialect
  abstraction is built ahead of time.

## How this design was chosen

Four candidate designs were sketched in parallel (2× gpt-6-astra, 2× gpt-6.1-sol) and scored by a
gpt-6-astra cross-judge. Candidate 4 (API-owned database, two workspaces) won 22/25; the other three put the
database in a shared `packages/db`, which had a single consumer. Grafted in: two cached CI jobs (candidate 1),
a rejection test proving nothing is stored (candidate 2), and a seed idempotency test (candidate 3).
