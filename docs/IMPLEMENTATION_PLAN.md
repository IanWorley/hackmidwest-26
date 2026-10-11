# Closure Call — Implementation Plan

**Challenge:** USDA "Closure Call: Weather-Driven Facility Decisions and Notification"
**Platform target:** Akamai Cloud AI Challenge (deployable, beyond-a-chatbot AI app)
**Optional bonus:** AWS "Best Use of Strands Agents SDK" (see Step 8 for why this is a stretch goal here)

> A weather-driven facility-closure decision-support and notification system. It ingests live
> National Weather Service data plus at least one supplementary signal, evaluates threat against a
> facility, recommends a *graded* closure posture to a human decision-maker (with reasoning),
> builds a targeted notification package, and writes an auditable decision record.
>
> **Design principle:** the system supports the decision; it does not make it. Human-in-the-loop
> is intentional, not a limitation.

This plan builds on the monorepo as it exists today (see [ARCHITECTURE.md](ARCHITECTURE.md) and
[CONTRIBUTING.md](../CONTRIBUTING.md)). The domain requirements are unchanged from the challenge brief;
the implementation details follow the repo's existing shape rather than inventing a new one.

---

## 0. Guiding Constraints (from the challenge brief)

- **Live data, not mocks.** The demo must hit the real NWS API against active weather somewhere in the US.
- **Graded recommendation, not binary.** Postures: `normal` / `delayed_arrival` / `early_dismissal` / `unscheduled_telework` / `full_closure`.
- **Narrow and deep beats broad and shallow.** One facility profile + two or three hazard types done well.
- **The decision record is the differentiator.** Most teams skip it; the agency cares most about it.
- **Threshold defensibility.** Every cutoff needs a cited reason (NWS severity fields, state DOT thresholds, OPM operating-status categories).
- **Timing drives the posture.** *When* a hazard hits relative to the commute and operating hours decides
  between delay, early dismissal, telework, and closure. The notification must arrive before employees
  leave the house (see Step 5.1).

---

## 1. How the feature maps onto the existing architecture

The repo already has four workspaces with hard boundaries enforced by Biome and dependency-cruiser. Closure
Call fits into them without a new workspace:

| Concern | Lives in | Why |
|---|---|---|
| Tables, migrations, seed fixture (facility, rosters, thresholds, records) | `packages/db` | Only place tables live; migrations are committed and shared by tests. |
| NWS and supplementary-signal ingestion, threshold engine, decision records, notification package, all HTTP routes the web uses | `apps/api` | The API is the only SQLite writer and owns every domain rule. Features are Effect programs; external clients become services in `runtime.ts`. |
| LLM-phrased rationale and an agent-facing orchestration endpoint | `apps/agent-api` | Built for agent and AI callers. Reads recommendations from `apps/api` over HTTP via an Eden client; never opens the database. |
| Decision screen, recommendation view, notification preview | `apps/web` | TanStack Start routes; loaders call `apps/api` through the single Eden client. |

Rules that shape every step below:

- `apps/api` writes SQLite. `apps/agent-api` never touches `@hackmidwest/db`; it yields the `TasksApi`-style Eden service.
- Posture selection is deterministic TypeScript inside `apps/api`. No LLM call sits on the path that picks a posture.
- Config is read once in each backend's `src/index.ts` → `config.ts`. Nothing else reads `process.env`.
- Every external call (NWS, Open-Meteo, LLM) is an Effect service with a `Layer.succeed` in production and a stub layer in tests.
- The existing `tasks` feature is scaffolding. Nothing in this plan depends on it, and Step 13 removes it once
  Closure Call has its own table, routes, page, and verify recipes.

### Target file layout (additions only)

```
packages/db/
├── drizzle/
│   └── 0001_closure_call.sql          # generated tables + hand-added add-only triggers
└── src/
    ├── schema/                        # one file per domain, listed in schema/index.ts:
    │                                  # facilities.ts, roster.ts, decision-records.ts
    ├── seed.ts                        # seedDemoFacility(): one service center + ~15–25 employees
    └── seed.test.ts                   # seed idempotency for the new fixture keys

apps/api/src/
├── config.ts                          # + NWS_USER_AGENT
├── runtime.ts                         # + NwsClient, OpenMeteoClient services on the layer
├── clients/
│   ├── nws.ts                         # NwsClient implementation (fetch + Effect.retry/timeout + points cache)
│   └── open-meteo.ts                  # OpenMeteoClient implementation (keyless AQI)
└── features/closure/
    ├── postures.ts                    # POSTURES const tuple + TypeBox literal union
    ├── thresholds.ts                  # cutoffs with { value, unit, source, citation } per hazard
    ├── readings.ts                    # Reading shape + normalizers from NWS/Open-Meteo payloads
    ├── timing.ts                      # hazard window vs facility day (pure, takes `now`)
    ├── engine.ts                      # evaluatePosture(): pure, deterministic, no I/O
    ├── roster.ts                      # building roster vs employee roster reconciliation
    ├── notifications.ts               # recipient logic, message draft, per-recipient send_by
    ├── records.ts                     # content hash, hash-chain links, canonical JSON
    ├── facilities.ts                  # Elysia module: GET /api/facilities, GET /api/facilities/:id
    ├── recommendations.ts             # Elysia module: POST evaluate, GET latest, GET by id, GET replay
    ├── decisions.ts                   # Elysia module: POST decision (accept/override/defer), GET history
    └── *.test.ts                      # one behavior per test, next to the file it covers

apps/agent-api/src/
├── config.ts                          # + OPENROUTER_API_KEY, OPENROUTER_MODEL (optional; degrades to template text)
├── runtime.ts                         # + Llm service
└── features/
    ├── narrate.ts                     # POST /recommendations/:id/narrate → LLM-phrased rationale
    └── orchestrate.ts                 # POST /facilities/:id/run → tool-style run log for agent callers

apps/web/src/
├── features/closure/                  # components + loaders, mirrors features/tasks
└── routes/
    ├── facilities.tsx                 # list of facilities
    └── facilities.$facilityId.tsx     # decision screen (recommendation, countdown, accept/override/defer)
```

---

## 2. Config & Scaffolding (Task 2)

- [ ] Add to `.env.example`: `NWS_USER_AGENT` (NWS asks for a descriptive contact string),
      `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` (optional, agent API only).
- [ ] Extend `apps/api/src/config.ts` and `apps/agent-api/src/config.ts` with the new variables, validated
      with the same t3env (`@t3-oss/env-core`) + Zod schemas already used for ports and origins. Optional
      keys are typed as `string | undefined`, never read elsewhere.
- [ ] Add the new feature files to the `verify-hackmidwest` feature map
      (`.agents/skills/verify-hackmidwest/features/`) as each entry point lands; AGENTS.md requires this in
      the same PR as the feature.
- [ ] README: problem statement, challenge-scoring map (Step 12), and the threshold-defensibility table.
- [ ] No YAML. Thresholds and the facility fixture are typed TypeScript so Biome's no-magic-number posture
      and `useExplicitReturnType` apply to them.

---

## 3. NWS / NOAA Client — Live Data (Task 3)

**Base URL:** `https://api.weather.gov` — public, free, no key. Requires a `User-Agent` header.

- [ ] Define `NwsClient` as a `Context.Service` in `apps/api/src/runtime.ts`, next to `Database`. Extend
      `apiLayer(db, clients)` so `ApiServices` picks it up automatically. `index.ts` builds the real client;
      tests provide `Layer.succeed(NwsClient, stub)`.
- [ ] Implementation in `apps/api/src/clients/nws.ts`. `fetch` is allowed in backends (only the web app bans
      it). Wrap each call in `Effect.tryPromise` with a tagged `NwsError`, add `Effect.timeout` and
      `Effect.retry` with a bounded exponential schedule. Cache `points` lookups in a `Map` inside the client.
- [ ] Endpoints:
  - `GET /points/{lat},{lon}` → grid, forecast URLs, zone/county IDs.
  - `GET /gridpoints/{office}/{gridX},{gridY}/forecast` and `/forecast/hourly` → periods; hourly is needed
    to tell *when* conditions cross a threshold relative to the commute (Step 5.1).
  - `GET /alerts/active?point={lat},{lon}` → alerts with `severity`, `certainty`, `urgency`, `event`,
    `effective`, `onset`, `ends`, `expires`, `messageType`, `references`.
    - Treat `onset`→`ends` as the hazard window. Fall back to `expires` only when `ends` is null and lower
      confidence when you do.
    - Carry `messageType` and `references` through so an Update or Cancel re-evaluates instead of counting
      as a new hazard.
  - `GET /stations/{id}/observations/latest` → wind speed/gust, temp, visibility.
- [ ] Validate responses with TypeBox schemas at the client boundary so a changed NWS payload fails as a
      typed error rather than deep inside the engine.
- [ ] Normalize into one `Reading` type (`features/closure/readings.ts`):
      `{ source, observedAt, metric, value, unit, rawRef }`.
- [x] Supplementary signal: `OpenMeteoClient` with the same service/stub pattern, producing AQI `Reading`s.
      State DOT road conditions stay optional.

**Why these fields matter:** NWS `severity` (Extreme/Severe/Moderate/Minor), `certainty`
(Observed/Likely/Possible), and `urgency` (Immediate/Expected/Future) map directly onto posture
thresholds and notification urgency.

---

## 4. Facility & Roster Data Model (Task 4)

All tables go in their domain file under `packages/db/src/schema/`, with limits exported as named constants the way
`TASK_TITLE_LENGTH` is today. Run `bun run db:generate`, inspect the SQL, commit migration + meta in the same
PR. Validators in `apps/api` are derived with `drizzle-typebox`, not hand-written.

- [ ] `facilities`: id, name, lat, lon, NWS zone, timezone, operating hours, hazard profile, and timing:
  - `arrival_window` (e.g. 06:30–09:00 local) and `departure_window` (e.g. 15:30–18:00 local).
  - `typical_commute_minutes`, `decision_deadline` (latest useful morning decision),
    `notification_lead_minutes`.
- [ ] `buildings` and `employees` are **separate lists** (the brief calls out that building rosters and
      employee rosters disagree). `employees` carries `assigned_building_id`, `essential_personnel`,
      `telework_eligible`, `current_status` (`in_office` / `teleworking` / `on_detail_elsewhere` / `leave`),
      contact channels, accessibility needs, optional `shift_start`/`shift_end` and `commute_minutes`
      overrides. Reconciliation happens only in `features/closure/roster.ts`.
- [ ] `decision_makers`: id, name, role, facilities they can decide for, designated backup per facility.
- [ ] Enum-like columns (`posture`, `current_status`, `action`, `reason_category`) use a `text` column with
      a `CHECK` built from an exported `as const` tuple, the same way `tasks_title_length` inlines its limits.
      The API derives `t.Union` literals from the same tuple so the HTTP contract and the DB constraint
      share one source.
- [ ] Seed: add `seedDemoFacility()` to `packages/db/src/seed.ts` following `seedDemoTasks()`: reserved fixture
      ids, `onConflictDoNothing`, one synthetic USDA Service Center + ~15–25 employees covering every edge
      case (essential, already teleworking, on detail, accessibility needs, early shift, long commute).
      Add an idempotency test next to the existing one.
- [ ] Times are stored as ISO-8601 UTC strings; local windows are stored as `HH:MM` plus the facility
      timezone and converted with `Intl.DateTimeFormat` / `Temporal` (whichever Bun 1.3 and Node 24 both
      support without a polyfill; decide once in `timing.ts`).

---

## 5. Graded Threshold Engine + Reasoning (Task 5)

- [ ] Pick **2–3 hazards** (recommended: winter storm/ice, severe wind/thunderstorm, wildfire-smoke/air-quality).
- [ ] `features/closure/thresholds.ts`: one typed object per hazard, each cutoff `{ value, unit, source,
      citation }`. No bare numbers in the engine; every comparison references a named threshold.
  - Winter: NWS Winter Storm Warning (`severity>=Severe`) → `full_closure`; Advisory → `delayed_arrival`.
  - Wind: anchored to NWS High Wind Warning criteria (~40 mph sustained / 58 mph gust) →
    `early_dismissal`/`closure`.
  - Air quality: AQI 151–200 (Unhealthy) → `unscheduled_telework`; 201+ → `closure`.
- [ ] `features/closure/engine.ts`: `evaluatePosture(input: EngineInput): Recommendation` is a **pure
      function**. It takes readings, alerts, the facility, thresholds, and `now`. No Effect, no I/O, no
      clock reads. This keeps it trivially testable with Vitest and replayable from a stored snapshot.
- [ ] `Recommendation` output must contain, per the brief:
  - [ ] Recommended posture (one of the five).
  - [ ] **Every input that drove it**, with source + timestamp.
  - [ ] **Which threshold was crossed and by how much** ("gusts 63 mph vs 58 mph cutoff → +5").
  - [ ] **Confidence** + **what would change the recommendation** (sensitivity statement).
  - [ ] A **one-paragraph plain-language rationale** generated from a template in `apps/api`. The LLM
        version (Step 8) is optional polish; the template is the one that gets stored.
- [ ] The Elysia module `features/closure/recommendations.ts` is the only place I/O meets the engine:
      `POST /api/facilities/:id/recommendations` yields `NwsClient`, `OpenMeteoClient`, `Database`, calls
      `evaluatePosture`, persists the snapshot (Step 7), and returns it. Accept an optional `asOf` ISO
      timestamp in the body to drive the "as-of" demo view (Step 9); default is the server clock, read once
      in the route and passed in.

### 5.1 Timing Logic (`features/closure/timing.ts`, pure)

Severity says *whether* a hazard matters; timing says *which* posture fits. A Winter Storm Warning
ending at 05:00 and one starting at 13:00 call for different responses.

- [ ] **Hazard window.** `[start, end]` from alert `onset`/`ends`, refined by the hourly forecast (first and
      last hour the threshold is exceeded). Add a configurable `postHazardBufferMinutes` per hazard in
      `thresholds.ts` with its rationale in the citation field.
- [ ] **Compare the window with the facility day:**

  | Hazard window vs. facility day | Default posture |
  |---|---|
  | Ends (plus buffer) before the arrival window opens | `normal` |
  | Overlaps the arrival window, ends within `maxDelayHours` | `delayed_arrival` (delay = hazard end + buffer − arrival start, rounded up to the configured increment) |
  | Overlaps the arrival window, lasts beyond `maxDelayHours` | `unscheduled_telework` or `full_closure` (by severity) |
  | Starts during operating hours, before the departure window | `early_dismissal` (release = hazard start − commute − buffer) |
  | Covers the whole operating day | `unscheduled_telework` or `full_closure` (by severity) |
  | Starts after operating hours end | `normal` today; flag next-day evaluation |

- [ ] **Express results the way OPM statuses do:** a delay as an hour count, an early dismissal as a
      departure time.
- [ ] **Decision deadline.** `decideBy = arrivalWindowStart − notificationLead − deliveryTime`. If
      evaluation runs after `decideBy`, say so in the output and escalate urgency (SMS/push instead of
      email-only).
- [ ] **Re-evaluation cadence.** Phase 1: on demand through the POST route and a button on the decision
      screen. Phase 2 (if time): an `Effect.schedule` loop started in `apps/api/src/index.ts` (the only place
      allowed to own process lifecycle) re-runs evaluation for every facility every 30 min overnight and every
      10 min within two hours of `decideBy`. If a recommendation changes after a human decision, write a
      new recommendation and flag it; never change the decision.
- [ ] **Data freshness.** Record `evaluatedAt` separately from each input's timestamp. Lower confidence when
      observations are older than a named staleness limit or the forecast `updateTime` is old.
- [ ] **Time zones.** Store UTC; convert to the facility zone only for windows and display. Handle DST
      (winter-storm season).
- [ ] **Timing in the sensitivity statement**: "If onset moves 2 hours earlier, this becomes early
      dismissal at 12:30 instead of normal operations."
- [ ] **Injectable clock.** `now` is a parameter of `evaluatePosture` and `timing.ts`. Routes read the clock
      once; tests pass fixed instants.

---

## 6. Roster Resolution + Notification Package (Task 6)

`features/closure/roster.ts` and `features/closure/notifications.ts` are pure functions over rows the
Elysia module loads. Nothing in this project actually sends email/SMS; the package is the artifact.

- [ ] Build the package from the **decided** posture (Step 7.1). Before a decision exists, the route returns
      it with `status: "preview"`; nothing is dispatched.
- [ ] Resolve recipients from the building roster, then filter/annotate by employee status:
  - Exclude already-teleworking (unless content differs for them).
  - Flag **essential personnel**; their message differs.
  - Exclude on-detail-elsewhere; include accessibility-aware routing.
- [ ] Output a **recipient list with explicit inclusion/exclusion logic** ("who's in and why").
- [ ] Draft the message: what's happening, whether it applies to *them specifically*, what to do, timed to
      arrive **before they leave the house**.
- [ ] Channel routing by urgency (mapped from NWS `urgency`) and employee preference.
- [ ] **Per-recipient send time.** `sendBy = start time − commute − lead`, honoring employee overrides.
- [ ] **Late-notice handling.** Recipients whose `sendBy` has passed are flagged and routed to the fastest
      channel.
- [ ] **Follow-up messages.** Posture-change update and all-clear drafts, each linked to the original
      decision.
- [ ] Routes: `GET /api/decisions/:id/notifications` (package for a decision) and
      `GET /api/recommendations/:id/notifications/preview`.

---

## 7. Decision Record — Auditable Snapshot (Task 7)

> The highest-value deliverable. Build it as first-class rows with a hash chain, not a log line.

- [ ] `recommendations` table: one immutable row per evaluation. Columns for facility, `evaluatedAt`,
      `asOf`, posture, confidence, `decideBy`, and a `snapshot` JSON column holding the full engine input
      and output (readings with source + timestamp, thresholds evaluated, hazard window, rationale, recipient
      preview). Plus `contentHash` (SHA-256 of canonical JSON via `node:crypto`).
- [ ] **Reconstructable after the fact.** `GET /api/recommendations/:id/replay` loads the snapshot, calls
      `evaluatePosture` again with the stored `now`, and returns both results plus whether they match. Same
      inputs, same posture: proof the engine is deterministic.
- [ ] **Timeline**: `evaluatedAt`, each input's timestamp, hazard window, `decideBy`, `decidedAt`, each
      dispatch's planned and recorded time, and resulting lead time ("notified 94 min before the arrival
      window"). Flag any recipient whose record is after their `sendBy`.
- [ ] Storage is SQLite via Drizzle, like everything else. Exporting snapshots to Akamai object storage is a
      stretch item (Step 10), not a dependency.

### 7.1 Human Decision Capture

The system recommends; a named person decides. The decision is its own row, linked to the recommendation,
so the record shows both what the system advised and what the person chose.

- [ ] **Three tables, linked in order:** `recommendations` → `decisions` → `notification_dispatches`.
      Each stores the id **and** `contentHash` of the row before it. `records.ts` owns hashing and
      verification; `GET /api/decisions/:id/verify` walks the chain.
- [ ] **Decision actions:** `accept`, `override` (different posture), `defer` (re-check time, must be before
      `decideBy`).
- [ ] **Decision fields:** `recommendationId` + `recommendationHash` (exactly what the person saw),
      `facilityId`, `action`, `chosenPosture`, `decidedById`, `decidedAt` (UTC); minutes before/after
      `decideBy` are derived on read from `decidedAt` and the recommendation's `decideBy`, not stored, `identityVerified` (always `false` in the demo; see below).
- [ ] **Reasons:** required for `override` and `defer`; a category (`local_conditions`, `road_reports`,
      `directive`, `essential_operations`, `data_looks_wrong`, `other`) plus free text. Enforced twice: a
      TypeBox body schema (so the route returns 422 with the field) and a `CHECK` in the migration.
- [ ] **Human-supplied information.** `human_inputs` table: `decisionId`, `reportedBy`, `reportedAt`,
      `text`. Returned alongside the recommendation's readings so a review sees everything.
- [ ] **Stale-view protection.** `POST /api/recommendations/:id/decisions` fails with a declared `409`
      when a newer recommendation exists for the facility; the body carries the new id. Declare the 409
      response next to the 201 and 500 so Eden types it and the web can show the new one.
- [ ] **Add-only storage.** The migration that creates `recommendations`, `decisions`,
      `notification_dispatches`, and `human_inputs` also adds `BEFORE UPDATE` / `BEFORE DELETE` triggers
      that `RAISE(ABORT)`. Write them by hand in the generated SQL file (drizzle-kit does not model
      triggers). Because tests run the committed migrations, a Vitest case can prove an UPDATE fails.
      Changing a decision inserts a new row with `supersedesDecisionId` and a reason.
- [ ] **Notifications wait for the decision.** The preview route never writes `notification_dispatches`;
      only `POST /api/decisions/:id/dispatch` does, and only once per decision.
- [ ] **Recommendation changes after a decision.** The decision screen loader compares the latest
      recommendation id with the decided one and shows a "newer recommendation" banner with a diff. Never
      auto-change the decision.
- [ ] **Missed deadline.** If evaluation runs after `decideBy` and no decision exists, write a
      `no_decision` row (a `decisions` row with `action = "no_decision"` and `decidedById = backup`) and
      surface the backup decision-maker on the screen. Phase 2: the scheduler loop does this unattended.
- [ ] **Decision screen** (`apps/web/src/routes/facilities.$facilityId.tsx`):
  - Loader fetches facility + latest recommendation + decision history through the Eden client in
    `lib/api.ts`. Route loaders own data; no TanStack Query unless the countdown needs polling later.
  - Shows posture, reasoning, confidence, and a countdown to `decideBy` (client-side interval; the loader
    supplies the instant).
  - Accept / Override / Defer. Override opens a posture picker; Override and Defer require a reason.
  - Confirmation step lists who will be notified and through which channels (from the preview route).
  - Accessible: keyboard-operable, labeled controls, countdown not reliant on color alone.
  - Mutations go through Eden's `.post()`; the web app's `fetch` ban stays in place.
- [ ] **Identity.** No auth; `decidedBy` is picked from `decision_makers`. `identityVerified: false` is
      stored and shown. Production would use agency single sign-on.
- [ ] **Nice-to-have:** `GET /api/reports/overrides` (override rate by reason category and facility).

---

## 8. Agent API: Narration and Orchestration (Task 8)

`apps/agent-api` is the AI-facing surface. It follows its existing shape: a service in `runtime.ts`, one
Elysia module per feature, Eden client to `apps/api`, no database, generic 500.

- [ ] **`Llm` service.** `Context.Service` providing one `narrate(prompt) → Effect<string, LlmError>`.
      Production layer calls OpenRouter's chat completions endpoint (`https://openrouter.ai/api/v1`) with
      plain `fetch`, `Authorization: Bearer OPENROUTER_API_KEY`, and the model id from `OPENROUTER_MODEL`.
      No vendor SDK: OpenRouter is OpenAI-compatible, so one small typed request/response schema in the
      client file is enough and the model can change per environment without a code change. Set
      `HTTP-Referer` and `X-Title` headers so the app shows up in the OpenRouter dashboard. Tests use a
      stub. If `OPENROUTER_API_KEY` is absent, `index.ts` provides a layer that returns the API's template
      rationale unchanged, so the agent API still starts and `verify-hackmidwest` still passes.
- [ ] **`POST /recommendations/:id/narrate`.** Reads the recommendation from `apps/api` via Eden, asks the
      LLM to phrase the stored rationale for a manager's email, returns `{ template, narrated }`. The LLM
      never sees a "choose posture" instruction; the prompt states the posture as fixed input.
- [ ] **`POST /facilities/:id/run`.** An orchestration endpoint for agent callers that calls the API's
      evaluate route, then the preview route, then narrate, and returns a step-by-step run log (tool name,
      input, output, timing). This is the "beyond a chatbot" demo for agent consumers.
- [ ] **No decision or dispatch tools.** The agent API never calls `POST .../decisions` or `.../dispatch`.
      Those happen only through the human decision screen.
- [ ] **Strands Agents SDK (AWS bonus).** Strands is a Python SDK; there is no TypeScript port in this
      stack, and the repo's boundaries assume Bun workspaces. If the bonus is pursued, it is a separate
      Python sidecar that exposes `@tool` wrappers over the agent API's HTTP routes, kept outside `apps/`
      and `packages/`. Decide on Saturday evening based on remaining time; it is last in the build order.

---

## 9. Demo Entry Points (Task 9)

There is no CLI in this repo and none is planned. The demo runs through the web app and the two HTTP
APIs, driven the same way the `verify-hackmidwest` skill drives them.

- [ ] Web: `/facilities` → `/facilities/:id` shows the live recommendation; "Re-evaluate" posts a fresh
      one; Accept/Override/Defer records the decision; the confirmation step shows the package.
- [ ] HTTP: `POST /api/facilities/:id/recommendations` with `{ "asOf": "<iso>" }` re-runs the same live
      data "as of" a chosen instant (e.g. 04:30 local on the alert day). The response and the screen label
      as-of views clearly so they are not mistaken for a mock feed.
- [ ] Point the seeded facility at a lat/lon with **currently active alerts**; there is almost always
      severe weather somewhere in the US. Keep facility coordinates editable in the seed so the location can
      move on demo morning without a migration.
- [ ] Agent API: `POST /facilities/:id/run` for the agent-caller story; `POST /recommendations/:id/narrate`
      for the LLM-phrased rationale.

---

## 10. Akamai Cloud Deployment

- [ ] Provision a Linode instance (hackathon credits).
- [ ] One `Dockerfile` per app, or one multi-stage image that runs `bun run build` and starts the three
      `start` scripts with `DB_PATH` on a mounted volume. `apps/api` is the only writer, so a single SQLite
      file on a volume is enough for the demo.
- [ ] `VITE_API_BASE_URL` is baked at build time and must be reachable from both browser and SSR; set it to
      the public API origin in the build step.
- [ ] Akamai-hosted inference or BYOI for narration if OpenRouter is not allowed on the platform; the `Llm`
      service is the one place that changes.
- [ ] Stretch: export each `recommendations` snapshot as JSON to Akamai object storage keyed by
      `contentHash`, from the same Effect program that inserts the row.

---

## 11. Verification (Task 9)

Unit tests are Vitest, one behavior per test, next to the file. Runtime proof goes through
`verify-hackmidwest` per AGENTS.md.

- [ ] **Engine** (`engine.test.ts`, `timing.test.ts`): each posture boundary; one case per row of the
      Step 5.1 table; `decideBy` passed; `ends` missing (fallback to `expires`); updated/cancelled alert;
      a DST transition day. All with a fixed `now`.
- [ ] **Roster** (`roster.test.ts`): every seeded employee edge case lands in the right bucket with the
      right reason.
- [ ] **Records** (`records.test.ts`): hash is stable across key order; chain verifies end to end; replay
      of a stored snapshot reproduces the posture.
- [ ] **Decisions** (`decisions.test.ts` via `createApp` + `app.handle` and `createTestDatabase()`):
      accept/override/defer each produce a linked row; override/defer without a reason is 422; stale
      recommendation is 409; UPDATE/DELETE on decision tables fails (trigger); no dispatch row exists before
      a decision; missed `decideBy` writes a `no_decision` row naming the backup.
- [ ] **Clients**: a stub `NwsClient` layer in API tests. One opt-in integration test (skipped unless
      `NWS_USER_AGENT` is set) performs a real pull and asserts normalization.
- [ ] **Agent API**: stub `apps/api` with the existing `node:http` pattern; stub `Llm`; prove the no-key
      layer returns the template rationale.
- [ ] **Web**: Testing Library tests for the decision form (reason required on override/defer, countdown
      text, confirmation list).
- [ ] **Runtime proof**: add feature files under `.agents/skills/verify-hackmidwest/features/` for the
      facility list, decision screen, evaluate route, decision route, and agent run route. Each PR runs the
      recipes, captures `snap`, `api`, `agent`, and `db` evidence, and publishes with `verify.sh publish`.
- [ ] Before every PR: `bun run fix`, `bun run lint`, `bun run check`, `bun run build`, `bun run test`.

---

## 12. Challenge-Scoring Map

The table lives in the [README](../README.md#challenge-scoring-map) so it has one source of truth.

---

## 13. Remove the `tasks` Scaffold

Decided: the scaffold goes once Closure Call covers the same ground. It is one PR, after Step 11 passes, so
there is always a working end-to-end path in the repo.

Preconditions: Closure Call has its own table and migration (Step 4), API routes with tests (Steps 5–7),
a web page (Step 7.1), an agent API feature (Step 8), and verify recipes (Step 11).

- [ ] `packages/db`: delete `schema/tasks.ts` and its `schema/index.ts` exports, generate the drop migration,
      remove `seedDemoTasks` and its tests. Keep `DEMO_TASK_ID`-style reserved fixture keys for the
      facility seed.
- [ ] `apps/api`: delete `features/tasks.ts` and its test; `createApp` mounts only closure modules.
- [ ] `apps/agent-api`: delete `features/task-summary.ts` and its test; rename the `TasksApi` service and
      `tasks-api.ts` to a general `Api` client since it now reads recommendations, not tasks.
      `TASKS_API_URL` becomes `API_URL` in `config.ts`, `.env.example`, `CONTRIBUTING.md`, and `verify.sh`.
- [ ] `apps/web`: delete `features/tasks/` and `routes/tasks.tsx`; the home route links to `/facilities`.
      Update the document title the verify skill asserts on.
- [ ] `verify-hackmidwest`: delete `tasks-list.md`, `create-task.md`, `tasks-load-error.md`, and the
      task-summary parts of `agent-api.md`; update `README.md`'s baseline preconditions (seed state) and the
      `up` readiness checks in `verify.sh`, which currently wait on `/api/tasks` and `/tasks`.
- [ ] Docs: README port table and "Where things live", ARCHITECTURE's type-flow diagram and agent API
      paragraph, CONTRIBUTING's seed description. Keep the `tasks-load-error` idea alive as a Closure Call
      load-failure recipe, since `STORAGE=broken` is still useful.
- [ ] `test/boundary-probes.ts`: swap any probe that imports `tasks` for a closure table.

---

## Suggested Build Order (one hackathon weekend)

1. Schema + migration + seed for facilities and rosters (Step 4). Tables first because every later PR
   derives validators from them.
2. `NwsClient` service with a live pull visible through a temporary `GET` route (Step 3). De-risks the
   hardest external dependency first.
3. `thresholds.ts`, `timing.ts`, `engine.ts` as pure code with tests (Step 5). No HTTP yet.
4. Recommendations route + snapshot + hash (Step 7). The differentiator; do it before notifications.
5. Decisions route with add-only triggers and stale-view 409 (Step 7.1).
6. Decision screen in the web app (Step 7.1).
7. Roster + notification package + preview/dispatch routes (Step 6).
8. Verification feature files and a full `verify-hackmidwest` run (Step 11).
9. Remove the `tasks` scaffold (Step 13).
10. Akamai deploy (Step 10).
11. Agent API narrate/run routes (Step 8), then the Strands sidecar only if time remains.

## Open decisions for Ian

- `docs/steering/*.md` still describe a Python layout. They should be rewritten to match this plan in a
  follow-up so Kiro and other agents stop reading the old structure.
- Supplementary signal: **decided, Open-Meteo** (#20). AirNow was the first choice, but its data use
  guidelines say agency-reported data "should not be used ... to support any other government or public
  decision-making", which is this product's purpose. Open-Meteo's air-quality API is keyless and CC BY 4.0,
  with no decision-use restriction. Its US AQI is modeled (CAMS), not monitor-observed, so the rationale
  should say "modeled AQI". The free tier is non-commercial and needs CAMS/Open-Meteo attribution; a
  commercial deployment needs a paid plan.
