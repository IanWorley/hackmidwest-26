# Architecture

## Shape

Four Bun workspaces:

- `packages/db` (`@hackmidwest/db`) owns persistence: Drizzle tables, the libSQL connection, committed
  migrations, the seed, and the `createTestDatabase()` fixture (`@hackmidwest/db/testing`). It has no HTTP
  dependency. It ships TypeScript source; Bun and Vitest load it directly, with no build step.
- `apps/api` owns HTTP: Elysia features and the TypeBox validators derived from `@hackmidwest/db` tables.
- `apps/agent-api` (`@hackmidwest/agent-api`) runs prompts against LLM providers and streams the result as
  server-sent events, recording each run in `agent_runs`. Providers implement one `AgentProvider` interface
  (`src/providers/provider.ts`) with the vendor's official SDK; `ProviderRegistry` is a `Record` over
  `PROVIDER_IDS`, so adding an id without an implementation fails to compile. Claude (`claude-opus-5-5`) is
  the first provider, with server-side refusal fallback enabled. A provider yields text and returns how the run
  ended (`completed` or `refused`). The runner owns the other endings: `failed` when the provider throws,
  `cancelled` when the client disconnects, and `failed` at startup for any run a crash left `running`.
  The agent API listens on `localhost` only, because runs spend provider credits and there is no auth yet.
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

## Testing

Vitest runs on Node, so the API uses `@libsql/client/sqlite3` (works on Bun and Node) rather than `bun:sqlite`.
Each test opens a private `file::memory:` database, applies the real committed migrations, and closes it.
API tests call `app.handle(new Request(...))` — real validation and serialization, no ports.

## Tradeoffs accepted

- The agent API owns its provider abstraction instead of adopting a multi-vendor SDK, so each adapter keeps its
  vendor's full types and features. The interface carries only text and an ending until a feature needs more
  (tool calls, thinking).
- Agent-run SSE frames are encoded to bytes by a hand-written stream. Elysia 1.4's `sse()` enqueues strings,
  which Node rejects, and its stream does not await generator cleanup on cancel. Ours resolves cancel only after
  the run's row is written. The cost is that Eden does not infer the stream's event types.
- Agent-run streams disable Bun's 30 s idle timeout per request. Thinking and refusal fallbacks can leave a
  stream silent for longer, and the timeout would cut the run off. A proxy in front would need its own setting.
- Both APIs write one SQLite file. libSQL's busy timeout (5 s) makes a writer wait for the other process's lock
  instead of failing with `SQLITE_BUSY`. libSQL calls are synchronous, so a waiting writer blocks its event loop
  for the length of the other write, which is milliseconds for this app's statements.
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
