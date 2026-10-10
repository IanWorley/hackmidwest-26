<img src="assets/icon.svg" width="64" height="64" alt="">

# HackMidwest-26

A Bun monorepo with three apps and a shared database package:

| App | Stack | Port |
|-----|-------|------|
| `apps/web` | TanStack Start (React + React Compiler, file-based TanStack Router) | 3000 |
| `apps/api` | ElysiaJS on Bun — tasks API | 3001 |
| `apps/agent-api` | ElysiaJS on Bun — streams agent runs from pluggable LLM providers | 3002 |
| `packages/db` | Drizzle ORM + SQLite (libSQL): tables, migrations, seed | — |

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

The agent API needs Anthropic credentials (`ANTHROPIC_API_KEY` in `.env`). Start a run and watch it stream:

```sh
curl -N -X POST localhost:3002/api/agent-runs \
  -H 'content-type: application/json' \
  -d '{"provider":"anthropic","prompt":"Plan a hackathon demo"}'
curl localhost:3002/api/agent-runs/1   # the recorded run
```

## Commands

| Command | What it does |
|---------|--------------|
| `bun run dev` | Run both APIs and web together; Ctrl+C stops all |
| `bun run test` / `test:watch` | Vitest unit tests (`--project api` or `--project web` to narrow) |
| `bun run format` / `format:check` | Biome formatter |
| `bun run lint` | Biome linter and import order |
| `bun run fix` | Apply all safe Biome fixes (format, lint, import order) |
| `bun run check` | TypeScript for every workspace (generates the route tree first) |
| `bun run build` | Production builds of both apps |
| `bun run db:generate` | Generate a migration after editing `packages/db/src/schema.ts` |
| `bun run db:migrate` / `db:seed` | Apply migrations / insert demo data (safe to re-run) |

CI runs format, lint, typecheck, build, and tests on every PR. [autofix.ci](https://autofix.ci) runs `bun run fix` on PRs and pushes any changes back to the branch.

## Where things live

- `packages/db/src/schema.ts` — tables and their shared limits.
- `apps/api/src/features/` — one Elysia module per feature; validators derived from tables, plus queries.
- `apps/api/src/contract.ts` — the type-only `App` export the web app consumes.
- `apps/agent-api/src/providers/` — the `AgentProvider` interface and one adapter per LLM vendor.
- `apps/agent-api/src/features/agent-runs.ts` — `POST /api/agent-runs` (SSE) and `GET /api/agent-runs/:id`.
- `apps/web/src/routes/` — file-based routes; loaders call the API through Eden.
- `apps/web/src/lib/api.ts` — the single Eden client.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the change workflow and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design rationale.
