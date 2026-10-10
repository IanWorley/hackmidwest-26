# Contributing

Use the Bun and Node versions recorded in `.bun-version` and `.node-version`. Install at the repository root with `bun install --frozen-lockfile`, copy `.env.example` to `.env`, then run `bun run db:migrate`, `bun run db:seed`, and `bun run dev`. Stop both processes with Ctrl+C. The root dev command supervises both; do not run a second API against the same SQLite file.

Edit a TypeScript file under `apps/web/src/routes` to add a page. Start generates the route tree during dev and build. `bun run check:web` generates it before typechecking, so a fresh clone needs no prior dev session. `routeTree.gen.ts` is ignored and never edited by hand. Route identifiers inside `createFileRoute` must match the filename and stay literals for the generator.

Edit `apps/api/src/db/schema.ts` to change persistence. Run `bun run db:generate`, inspect the SQL, commit its migration and metadata, then run `bun run db:migrate`. Schema edits and generated migrations go in the same PR. Migrations have one operator at a time; app startup never migrates. Never use `drizzle-kit push` against shared data. Tests use committed migrations, so a stale schema change fails its focused behavior test.

The seed (`apps/api/src/db/seed.ts`) inserts one row at a reserved development fixture key and ignores conflicts. A second run preserves any existing row. It does not clear tables. Seed only your local development database. `DB_PATH` resolves against the root; the directory is created on first open. `.env` and `.data/` are ignored.

Add focused Vitest tests next to the feature or table, one behavior per test. API tests construct `createApp` and call `app.handle`; every database test gets its own migrated memory connection via `createTestDatabase()`. Close it in `finally`. Web tests render components with Testing Library. API tests run in Node fork workers using libSQL, never `bun:sqlite`. Vitest is the unit test runner; do not add a competing Bun test suite.

Before opening a PR, run `bun run format`, `bun run lint`, `bun run check`, `bun run build`, and `bun run test`. CI runs two jobs: static checks (format, lint, typecheck, build) and unit tests. Dependency versions are exact; commit `bun.lock` with every dependency change and rerun all checks. Use conventional commit messages. Agent-written PRs identify the model, provider, and reasoning effort (e.g. `## Model: Claude Code (Opus 5.5) Reasoning: low`), then describe the change and validation clearly.

The web app may import API types only through `@hackmidwest/api/contract`. Do not add a relative import into API source or a duplicate shared Task interface. Package export conditions reject runtime imports, and Biome rejects relative server imports. Eden is the only HTTP client for application endpoints. Elysia is present in the web dependency graph because Eden declares it as a peer; application code never imports an Elysia runtime value there.
