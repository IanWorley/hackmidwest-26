<img src="assets/icon.svg" width="64" height="64" alt="">

# HackMidwest-26

## Closure Call

When severe weather heads for a federal facility, a manager has to choose the operating posture before employees leave home. The choices are normal operations, delayed arrival, early dismissal, unscheduled telework, or full closure. The decision has to be defensible later, so the reasons behind it matter as much as the call.

Closure Call is a decision-support tool for that moment. It reads live National Weather Service data and air quality and checks them against cited thresholds. It then recommends a graded posture with its reasoning and a decide-by time, drafts the notification, and writes a tamper-evident record of what the manager decided.

The system recommends and a person decides. Accept, override, and defer are the only ways a posture takes effect, and override and defer require a reason. The human-in-the-loop design is intentional, not a limitation.

The build is in progress. See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) for the steps the table below refers to.

### Challenge-scoring map

| Deliverable / Criterion | Where it's satisfied |
|---|---|
| Live NWS data | Step 3 (`NwsClient`) + live demo |
| Graded recommendation w/ reasoning | Step 5 (`engine.ts`) |
| Timing ("before they've left the house") | Steps 5.1, 6, 7 |
| Threshold defensibility (cited cutoffs) | `thresholds.ts` + README threshold table (after [#21](https://github.com/IanWorley/hackmidwest-26/issues/21)) |
| Notification package (who/why/channel) | Step 6 |
| Decision record (reconstructable) | Step 7 (hash chain, replay route) |
| Human decision (accept/override/defer, with reasons) | Step 7.1 + decision screen |
| Map (situational awareness across facilities) | `/conditions` view ([#40](https://github.com/IanWorley/hackmidwest-26/issues/40)) |
| Akamai: beyond a chatbot, real problem, execution, creativity | Steps 7, 8, 10 + web app + `/conditions` map |
| AWS: Strands Agents SDK (optional) | Step 8 sidecar, if time |

### Map tiles

The `/conditions` map uses two tile sources. Neither needs an API key or an account, so there is nothing to add to `.env`. The browser loads the tiles directly, and the URL templates and attribution strings live in typed constants under `apps/web/src/features/map/`.

| Layer | Source | URL template | License |
|---|---|---|---|
| Base map | USGS The National Map (USGSTopo) | `https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}` | Public domain |
| Radar | Iowa Environmental Mesonet NEXRAD base reflectivity (n0q) | `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png` | Public domain |

The USGS path is `{z}/{y}/{x}`, with row before column, and the IEM path is `{z}/{x}/{y}`. Swapping them renders the wrong tiles without an error. The radar mosaic refreshes every 5 minutes, and the `/cache/` endpoint caches it for the same 5 minutes.

Both providers request credit but do not require it. Show both in the Leaflet attribution control whenever the layer is on:

- USGS: "Map services and data available from U.S. Geological Survey, National Geospatial Program." ([USGS copyrights and credits](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits))
- IEM: "Radar: Iowa Environmental Mesonet, Iowa State University." IEM provides its data without any warranty of accuracy. ([IEM disclaimer](https://mesonet.agron.iastate.edu/disclaimer.php))

## The monorepo

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
