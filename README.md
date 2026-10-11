<img src="assets/icon.svg" width="64" height="64" alt="">

# HackMidwest-26

A Bun monorepo with three apps and a shared database package:

| App | Stack | Port |
|-----|-------|------|
| `apps/web` | TanStack Start (React + React Compiler, file-based TanStack Router) | 3000 |
| `apps/api` | ElysiaJS on Bun | 3001 |
| `apps/agent-api` | ElysiaJS on Bun, for agent and AI endpoints | 3002 |
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

Replace the placeholder `NWS_USER_AGENT` in `.env` with your own app name and contact. The API will not start without it.

Open <http://localhost:3000/tasks>. The API serves `GET/POST /api/tasks` on <http://localhost:3001>. The agent API serves `GET /health` and `GET /tasks/summary` on <http://localhost:3002>, reading tasks from the API over HTTP.

## Commands

| Command | What it does |
|---------|--------------|
| `bun run dev` | Run the API, agent API, and web together; Ctrl+C stops all three |
| `bun run test` / `test:watch` | Vitest unit tests (`--project api`, `--project agent-api`, or `--project web` to narrow) |
| `bun run format` / `format:check` | Biome formatter |
| `bun run lint` | Biome linter and import order |
| `bun run fix` | Apply all safe Biome fixes (format, lint, import order) |
| `bun run check` | TypeScript for every workspace (generates the route tree first) |
| `bun run build` | Production builds of all three apps |
| `bun run db:generate` | Generate a migration after editing `packages/db/src/schema.ts` |
| `bun run db:migrate` / `db:seed` | Apply migrations / insert demo data (safe to re-run) |

CI runs format, lint, typecheck, build, and tests on every PR. [autofix.ci](https://autofix.ci) runs `bun run fix` on PRs and pushes any changes back to the branch.

## Where things live

- `packages/db/src/schema.ts` — tables and their shared limits.
- `apps/api/src/features/` — one Elysia module per feature; validators derived from tables, plus queries.
- `apps/api/src/contract.ts` — the type-only `App` export the web app consumes.
- `apps/agent-api/src/features/` — agent and AI endpoints, built the same way as the API's features.
- `apps/web/src/routes/` — file-based routes; loaders call the API through Eden.
- `apps/web/src/lib/api.ts` — the single Eden client.

## Adding an app or package

1. Create `apps/<name>` or `packages/<name>` with its `package.json`, and add the path to the root `workspaces` list.
2. Copy the Biome template for its kind to `<workspace>/biome.jsonc`:

   | Kind | Template |
   |------|----------|
   | Shared package (`packages/*`) | `templates/biome/library.jsonc` |
   | Bun server app (`apps/*`) | `templates/biome/server-app.jsonc` |
   | Browser app (`apps/*`) | `templates/biome/web-app.jsonc` |

3. Run `bun run lint`. Every rule is an error, so fix the code first; add an exception to the workspace's `biome.jsonc` only with a comment saying why.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the change workflow and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design rationale.
