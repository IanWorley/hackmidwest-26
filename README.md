<img src="assets/icon.svg" width="64" height="64" alt="">

# HackMidwest-26

A Bun monorepo with two apps:

| App | Stack | Port |
|-----|-------|------|
| `apps/web` | TanStack Start (React + React Compiler, file-based TanStack Router) | 3000 |
| `apps/api` | ElysiaJS on Bun, Drizzle ORM + SQLite | 3001 |

Types flow end to end with no hand-written DTOs:
Drizzle table → `drizzle-typebox` validators → Elysia routes → Eden Treaty → React loader data.

## Quickstart

Requires Bun (see `.bun-version`) and Node (see `.node-version`; Vitest runs on Node).

```sh
bun install
cp .env.example .env
bun run db:migrate
bun run db:seed
bun run dev
```

Open <http://localhost:3000/tasks>. The API serves `GET/POST /api/tasks` on <http://localhost:3001>.

## Commands

| Command | What it does |
|---------|--------------|
| `bun run dev` | Run API and web together; Ctrl+C stops both |
| `bun run test` / `test:watch` | Vitest unit tests (`--project api` or `--project web` to narrow) |
| `bun run format` / `format:check` | Biome formatter |
| `bun run lint` | Biome linter |
| `bun run check` | TypeScript for both apps (generates the route tree first) |
| `bun run build` | Production builds of both apps |
| `bun run db:generate` | Generate a migration after editing `apps/api/src/db/schema.ts` |
| `bun run db:migrate` / `db:seed` | Apply migrations / insert demo data (safe to re-run) |

CI runs format, lint, typecheck, build, and tests on every PR.

## Where things live

- `apps/api/src/db/schema.ts` — tables and the TypeBox validators derived from them.
- `apps/api/src/features/` — one Elysia module per feature; validation and queries together.
- `apps/api/src/contract.ts` — the type-only `App` export the web app consumes.
- `apps/web/src/routes/` — file-based routes; loaders call the API through Eden.
- `apps/web/src/lib/api.ts` — the single Eden client.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the change workflow and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design rationale.
