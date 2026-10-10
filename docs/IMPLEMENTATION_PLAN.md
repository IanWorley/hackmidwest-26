# Closure Call — Implementation Plan

**Challenge:** USDA "Closure Call: Weather-Driven Facility Decisions and Notification"
**Platform target:** Akamai Cloud AI Challenge (deployable, beyond-a-chatbot AI app)
**Optional bonus:** AWS "Best Use of Strands Agents SDK"

> A weather-driven facility-closure decision-support and notification system. It ingests live
> National Weather Service data plus at least one supplementary signal, evaluates threat against a
> facility, recommends a *graded* closure posture to a human decision-maker (with reasoning),
> builds a targeted notification package, and writes an auditable decision record.
>
> **Design principle:** the system supports the decision; it does not make it. Human-in-the-loop
> is intentional, not a limitation.

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

## 1. Project Structure

```
closure-call/
├── README.md
├── IMPLEMENTATION_PLAN.md        # this file
├── requirements.txt              # core deps only (requests/httpx, pydantic)
├── requirements-agents.txt       # optional: strands-agents, strands-agents-tools
├── .env.example                  # AKAMAI/inference endpoints, optional AWS creds for Strands
├── config/
│   ├── thresholds.yaml           # defensible cutoffs + source citation per hazard
│   └── facility.yaml             # synthetic facility + roster seed data
├── closure_call/
│   ├── __init__.py
│   ├── nws_client.py             # Step 3: live NWS ingestion
│   ├── signals/
│   │   ├── __init__.py
│   │   ├── base.py               # Signal interface (fetch -> normalized reading)
│   │   ├── airnow.py             # supplementary signal: air quality (wildfire smoke)
│   │   └── state_dot.py          # supplementary signal: road conditions (optional 2nd)
│   ├── models.py                 # Step 4: Facility, Employee, Reading, Recommendation, DecisionRecord
│   ├── roster.py                 # Step 4/6: building vs employee roster resolution
│   ├── threshold_engine.py       # Step 5: graded posture + reasoning
│   ├── notifier.py               # Step 6: recipient logic, message draft, channel routing
│   ├── decision_record.py        # Step 7: auditable snapshot (what/when/why)
│   ├── decisions.py              # Step 7.1: human accept/override/defer, add-only
│   └── agents/                   # Step 8: OPTIONAL Strands orchestration (lazy import)
│       ├── __init__.py
│       └── orchestrator.py
├── cli.py                        # demo entrypoint: run end-to-end for a facility
└── tests/
    ├── test_threshold_engine.py
    ├── test_roster.py
    └── test_decision_record.py
```

**Dependency boundary:** core project runs with only `requirements.txt`. The Strands layer is isolated
under `agents/` and lazily imported so the system fully works without it.

---

## 2. Config & Scaffolding (Task 2)

- [ ] Create the directory tree above.
- [ ] `requirements.txt`: `httpx` (or `requests`), `pydantic`, `pyyaml`, `pytest`.
- [ ] `requirements-agents.txt`: `strands-agents`, `strands-agents-tools`.
- [ ] `.env.example`: Akamai inference endpoint/key (or BYOI), optional AWS creds for Strands/Bedrock.
- [ ] `README.md`: problem statement, architecture diagram, run instructions, challenge-mapping section, threshold-defensibility table.
- [ ] Set a descriptive **User-Agent** for NWS (the API requests one; see Step 3).

---

## 3. NWS / NOAA Client — Live Data (Task 3)

**Base URL:** `https://api.weather.gov` — public, free, no key. Requires a `User-Agent` header.

- [ ] `GET /points/{lat},{lon}` → resolves a coordinate to its grid, forecast URLs, and zone/county IDs.
- [ ] `GET /gridpoints/{office}/{gridX},{gridY}/forecast` → periods (temp, wind, short forecast).
- [ ] `GET /gridpoints/{office}/{gridX},{gridY}/forecast/hourly` → hourly periods; needed to tell
      *when* conditions cross a threshold relative to the commute (Step 5.1).
- [ ] `GET /alerts/active?point={lat},{lon}` (or `?zone={zoneId}`) → active alerts with structured
      `severity`, `certainty`, `urgency`, `event`, and the time fields `effective`, `onset`, `ends`, `expires`.
  - Treat `onset`→`ends` as the hazard window. `expires` is when the *message* expires, not when the
    hazard ends; fall back to it only when `ends` is null, and lower confidence when you do.
  - Track `messageType` (Alert / Update / Cancel) and `references` so an updated or cancelled alert
    triggers re-evaluation instead of being treated as new.
- [ ] `GET /stations/{id}/observations/latest` → current obs (wind speed/gust, temp, visibility).
- [ ] Normalize all responses into a common `Reading` object: `{source, observed_at, metric, value, unit, raw_ref}`.
- [ ] Add retry/backoff + a hard timeout; cache the `points` lookup (it's stable per location).

**Why these fields matter:** NWS alert `severity` (Extreme/Severe/Moderate/Minor), `certainty`
(Observed/Likely/Possible), and `urgency` (Immediate/Expected/Future) map directly onto posture
thresholds and notification urgency.

---

## 4. Facility & Roster Data Model (Task 4)

- [ ] `Facility`: id, name, lat/lon, NWS zone, operating hours, timezone, hazard profile, plus timing:
  - `arrival_window` (e.g., 06:30–09:00 local) and `departure_window` (e.g., 15:30–18:00 local).
  - `typical_commute_minutes` (used to back-calculate early-dismissal release times).
  - `decision_deadline` (e.g., 05:00 local — latest time a morning decision is useful).
  - `notification_lead_minutes` (how long before the arrival window starts a message must land).
- [ ] `Employee`: id, name, assigned_building_id, essential_personnel flag, telework_eligible flag,
      current_status (`in_office` / `teleworking` / `on_detail_elsewhere` / `leave`), contact channels
      (email/SMS/push), accessibility needs, optional `shift_start`/`shift_end` and `commute_minutes`
      overrides (shift workers and long commuters need earlier notice than the facility default).
- [ ] `DecisionMaker`: id, name, role, facilities they can decide for, and a designated backup per
      facility (used when `decide_by` passes with no decision; see Step 7.1).
- [ ] **Building roster vs employee roster are different lists** — model them separately and reconcile
      in `roster.py`. This mismatch is called out explicitly in the brief.
- [ ] Seed `config/facility.yaml` with one synthetic USDA Service Center + ~15–25 employees covering
      every edge case (essential, teleworking already, on detail, accessibility needs).

---

## 5. Graded Threshold Engine + Reasoning (Task 5)

- [ ] Pick **2–3 hazards** (recommended: winter storm/ice, severe wind/thunderstorm, wildfire-smoke/air-quality).
- [ ] For each hazard, define cutoffs in `config/thresholds.yaml`, each with a **cited source**:
  - Winter: NWS Winter Storm Warning (`severity>=Severe`) → `full_closure`; Advisory → `delayed_arrival`.
  - Wind: sustained/gust thresholds anchored to NWS High Wind Warning criteria (~40 mph sustained /
    58 mph gust) → `early_dismissal`/`closure`.
  - Air quality: AQI bands (AirNow) — 151–200 (Unhealthy) → `unscheduled_telework`; 201+ → `closure`.
- [ ] Engine output (`Recommendation`) must contain, per the brief:
  - [ ] Recommended posture (one of the five).
  - [ ] **Every input that drove it**, with source + timestamp.
  - [ ] **Which threshold was crossed and by how much** (e.g., "gusts 63 mph vs 58 mph cutoff → +5").
  - [ ] **Confidence** + **what would change the recommendation** (sensitivity statement).
  - [ ] A **one-paragraph plain-language rationale** a manager could paste into an email.
- [ ] Keep posture selection deterministic/rule-based (defensible + testable). Use the LLM only to
      phrase the rationale, never to pick the posture — preserves auditability.

### 5.1 Timing Logic

Severity says *whether* a hazard matters; timing says *which* posture fits. A Winter Storm Warning
ending at 05:00 and one starting at 13:00 call for different responses.

- [ ] **Hazard window.** For each hazard, compute `[start, end]` from alert `onset`/`ends`, refined by the
      hourly forecast (first and last hour the threshold is exceeded). Add a configurable
      `post_hazard_buffer` (e.g., time for roads to be treated after ice ends) and record its rationale
      in `thresholds.yaml`.
- [ ] **Compare the window with the facility day** (arrival window, operating hours, departure window):

  | Hazard window vs. facility day | Default posture |
  |---|---|
  | Ends (plus buffer) before the arrival window opens | `normal` |
  | Overlaps the arrival window, ends within `max_delay_hours` | `delayed_arrival` (delay = hazard end + buffer − arrival start, rounded up to the configured increment) |
  | Overlaps the arrival window, lasts beyond `max_delay_hours` | `unscheduled_telework` or `full_closure` (by severity) |
  | Starts during operating hours, before the departure window | `early_dismissal` (release time = hazard start − commute time − buffer) |
  | Covers the whole operating day | `unscheduled_telework` or `full_closure` (by severity) |
  | Starts after operating hours end | `normal` today; schedule an evaluation for the next day |

- [ ] **Express results the way OPM statuses do:** a delay as an hour count, an early dismissal as a
      departure time. This keeps the output aligned with OPM operating-status categories.
- [ ] **Decision deadline.** Compute `decide_by = arrival_window_start − notification_lead − delivery_time`
      and show it as a countdown. If evaluation runs after `decide_by`, say so in the output and escalate
      urgency (SMS/push instead of email-only).
- [ ] **Re-evaluation cadence.** Re-run on a schedule (e.g., every 30 min overnight, every 10 min within 2
      hours of `decide_by`) and whenever an alert is issued, updated, or cancelled. If the recommendation
      changes after a human decision, notify the manager; never change the decision automatically.
- [ ] **Data freshness.** Record `evaluated_at` separately from each input's timestamp. Lower confidence
      when observations are stale (e.g., older than 60 min) or the forecast `updateTime` is old.
- [ ] **Time zones.** Store all times in UTC; convert to the facility's local zone only for windows and
      display. Handle DST transitions (they fall in winter-storm season).
- [ ] **Timing in the sensitivity statement.** Include timing flips, e.g., "If onset moves 2 hours
      earlier, this becomes early dismissal at 12:30 instead of normal operations."
- [ ] **Injectable clock.** The engine takes `now` as an input instead of reading the system clock. This
      keeps it pure, makes tests deterministic, and enables replay.

---

## 6. Roster Resolution + Notification Package (Task 6)

- [ ] Build the package from the **decided** posture (Step 7.1). Before a decision exists, show it as a
      preview only; nothing is sent.
- [ ] Resolve recipients from the building roster, then filter/annotate by employee status:
  - Exclude already-teleworking (unless content differs for them).
  - Flag **essential personnel** — their reporting requirement usually does not change; message differs.
  - Exclude on-detail-elsewhere; include accessibility-aware routing.
- [ ] Output a **recipient list with explicit inclusion/exclusion logic** ("who's in and why").
- [ ] Draft the message: what's happening, whether it applies to *them specifically*, what to do,
      timed to arrive **before they leave the house**.
- [ ] Channel routing: email / SMS / push by urgency (map to NWS `urgency` field) and employee prefs.
- [ ] **Per-recipient send time.** Target `send_by = employee start time − commute − lead time`, using
      employee overrides when present, so early-shift workers and long commuters hear first.
- [ ] **Late-notice handling.** If `send_by` has already passed for some recipients, flag them in the
      package and route them to the fastest channel.
- [ ] **Follow-up messages.** Draft an update when the posture changes and an all-clear when the
      hazard ends, each linked to the original decision.

---

## 7. Decision Record — Auditable Snapshot (Task 7)

> The highest-value deliverable. Build it as a first-class artifact, not a log line.

- [ ] Persist an immutable snapshot per recommendation: all inputs with source+timestamp, thresholds
      evaluated, recommended posture, confidence, rationale, and recipient logic. The human decision is
      a separate linked record (Step 7.1).
- [ ] Make it **reconstructable after the fact** — "what was known, when, and what was decided."
- [ ] **Record the timeline:** `evaluated_at`, each input's timestamp, the hazard window used,
      `decide_by`, when the human decided, when each notification was sent, and the resulting lead time
      ("notified 94 min before the arrival window"). Flag any recipient notified after their `send_by`.
      This answers the brief's core question: was it fast enough?
- [ ] Store as versioned JSON (object storage on Akamai) with a content hash for tamper-evidence.
- [ ] Nice-to-have demo feature: **replay** — re-run the engine against a stored snapshot to show
      the same inputs yield the same posture.

### 7.1 Human Decision Capture

The system recommends; a named person decides. The decision is its own record, separate from the
recommendation, so the record shows both what the system advised and what the person chose.

- [ ] **Three record types, linked in order:** `Recommendation` (system) → `Decision` (human) →
      `NotificationDispatch` (what was sent). Each stores the ID and hash of the record before it.
- [ ] **Decision actions:**
  - `accept` — adopt the recommended posture.
  - `override` — choose a different posture.
  - `defer` — make no change yet and set a re-check time (must be before `decide_by`).
- [ ] **Decision fields:** `decision_id`, `recommendation_id` + `recommendation_hash` (exactly what the
      person saw), `facility_id`, `action`, `chosen_posture`, `decided_by` (name, role, and the authority
      they act under, e.g., facility manager or acting delegate), `decided_at` (UTC), and minutes before
      or after `decide_by`.
- [ ] **Reasons:**
  - Required for `override` and `defer`, optional for `accept`.
  - A category plus free text. Categories: local conditions observed, road or access reports, directive
    from regional office/OPM/local government, essential operations need, data looks wrong, other.
  - Categories make overrides comparable across managers and facilities, which addresses the brief's
    point that two managers can reach different decisions under identical conditions.
- [ ] **Human-supplied information.** When the decision-maker adds facts the system lacks (e.g., "county
      sheriff reports Route 9 closed"), store each as an input with source `human-reported`, who reported
      it, and a timestamp. A later review then sees everything the decision rested on.
- [ ] **Stale-view protection.** If a newer recommendation exists when the person submits, reject the
      submission and show the new one. This prevents a decision based on a recommendation that was
      already out of date.
- [ ] **Add-only storage.** No updates or deletes. Changing a decision creates a new `Decision` that
      `supersedes` the earlier one and states why. Enforce this in the database (e.g., triggers that
      reject UPDATE/DELETE on decision tables), not only in application code.
- [ ] **Notifications wait for the decision.** Drafts can be previewed beforehand, but nothing is sent
      until a `Decision` exists. An override regenerates the package for the chosen posture.
- [ ] **Recommendation changes after a decision.** Alert the decision-maker, show what changed, and let
      them issue a superseding decision. Never change the decision automatically.
- [ ] **Missed deadline.** If `decide_by` passes with no decision, notify a designated backup
      decision-maker and write a `no_decision` event to the record.
- [ ] **Decision screen (web view):**
  - Shows the recommendation, reasoning, confidence, and a countdown to `decide_by`.
  - Offers Accept / Override / Defer. Override opens a posture picker; Override and Defer require a reason.
  - Before submitting, a confirmation step shows who will be notified and through which channels.
  - Accessible: keyboard-operable, labeled form controls, and a countdown that doesn't rely on color alone.
- [ ] **Identity.** The demo has no authentication, so `decided_by` is selected, not verified. Record
      `identity_verified: false` and say so in the pitch; production would use agency single sign-on.
- [ ] **Nice-to-have:** an override report (override rate by reason category and facility) to show how
      the record supports consistency reviews.

---

## 8. OPTIONAL — Strands Agents SDK Orchestration (Task 8)

> Keep this layer entirely optional and lazily imported. The core system must run without it.
> This section exists to also qualify for the AWS "Best Use of Strands Agents SDK" prize.

**Install:** `pip install strands-agents strands-agents-tools` (default model provider is AWS Bedrock;
other providers available via extras). Requires AWS credentials for Bedrock, or configure another provider.

**Approach — wrap existing functions as tools:**

- [ ] Expose core capabilities as Strands tools using the `@tool` decorator:
  - `fetch_nws(lat, lon)` → wraps `nws_client`.
  - `fetch_supplementary(signal, location)` → wraps `signals/`.
  - `evaluate_posture(facility_id)` → wraps `threshold_engine` (deterministic; agent only orchestrates).
  - `resolve_recipients(facility_id, posture)` → wraps `roster` + `notifier`.
  - `write_decision_record(...)` → wraps `decision_record`.
- [ ] Build the orchestrator:
  ```python
  from strands import Agent, tool   # tools defined with @tool
  agent = Agent(tools=[...], system_prompt="You coordinate a facility closure decision-support run. "
                "You never choose the posture yourself; call evaluate_posture and present its result "
                "with full reasoning to the human decision-maker.")
  ```
- [ ] The agent's job is **orchestration and narration**, not decision authority — reinforces the
      human-in-the-loop requirement while showcasing agentic tool use (reason → call tools → compile).
- [ ] Do **not** give the agent a tool that records a decision or sends notifications. Those happen only
      through the human decision screen (Step 7.1).
- [ ] Document the fallback: if Strands/creds are absent, `cli.py` runs the same pipeline directly.

---

## 9. CLI / Demo Entrypoint (Task 8)

- [ ] `python cli.py --facility <id> [--agent]` runs the pipeline:
      pull live NWS → supplementary signal → graded recommendation + reasoning → notification preview
      → decision record on disk.
- [ ] `python cli.py decide <recommendation_id> --action accept|override|defer [--posture ...] --reason ...
      --by <decision_maker_id>` records the human decision, then finalizes the notification package.
- [ ] For the live demo, point the synthetic facility at a lat/lon with **currently active alerts**
      (there's almost always severe weather somewhere in the US).
- [ ] Demo time (Sunday morning) won't line up with every alert's window. Show the live result at the
      real current time, then optionally re-run the same live data "as of" a chosen time (e.g., 04:30 local
      on the alert day) using the injectable clock. Label the as-of view clearly so it isn't mistaken for
      a mock feed.
- [ ] Pretty-print the one-paragraph rationale and the recipient inclusion/exclusion logic for the pitch.

---

## 10. Akamai Cloud Deployment

- [ ] Provision a Linode instance (use the $300 hackathon credits).
- [ ] Containerize (`Dockerfile`); optionally deploy on Akamai's managed Kubernetes (LKE) to show scale.
- [ ] Use Akamai object storage for decision-record snapshots; a managed DB for facility/roster/audit data.
- [ ] Use Akamai-hosted AI inference (or BYOI) for rationale-phrasing; document the endpoint in `.env`.
- [ ] Expose a thin web view/API so the demo isn't CLI-only (helps the "beyond a chatbot" + usefulness scores).

---

## 11. Verification (Task 9)

- [ ] Unit tests: threshold engine (each posture boundary), roster resolution (every employee edge case),
      decision-record round-trip/replay.
- [ ] Timing tests with a fixed `now`: one case per row of the Step 5.1 table, the `decide_by`-passed
      path, `ends` missing (fallback to `expires`), an updated/cancelled alert, and a DST transition day.
- [ ] Decision tests: accept, override, and defer each produce a linked record; override/defer without a
      reason is rejected; a submission against a stale recommendation is rejected; UPDATE/DELETE on
      decision tables fails; no notification is sent before a decision exists; a missed `decide_by`
      writes a `no_decision` event and alerts the backup; the hash chain verifies end to end.
- [ ] Integration test: one real NWS pull succeeds and normalizes.
- [ ] End-to-end dry run via `cli.py` against a live active-alert location.
- [ ] Confirm the core pipeline runs with **only** `requirements.txt` installed (Strands absent).

---

## 12. Challenge-Scoring Map (put this in README)

| Deliverable / Criterion | Where it's satisfied |
|---|---|
| Live NWS data | Step 3 + CLI live demo |
| Graded recommendation w/ reasoning | Step 5 |
| Timing ("before they've left the house") | Steps 5.1, 6, 7 |
| Threshold defensibility (cited cutoffs) | `config/thresholds.yaml` + README table |
| Notification package (who/why/channel) | Step 6 |
| Decision record (reconstructable) | Step 7 |
| Human decision (accept/override/defer, with reasons) | Step 7.1 |
| Akamai: beyond a chatbot, real problem, execution, creativity | Steps 7, 8, 10 + web view |
| AWS: Strands Agents SDK (optional) | Step 8 |

---

## Suggested Build Order (one hackathon weekend)

1. Scaffold + config (Step 2)
2. NWS client with a live pull you can see working (Step 3) — de-risks the hardest external dependency first
3. Models + synthetic roster (Step 4)
4. Threshold engine + reasoning (Step 5) — the analytical core
5. Decision record (Step 7) — the differentiator; do it before notifications if time is tight
6. Human decision capture (Step 7.1) — start with accept/override/defer and required reasons; add the
   missed-deadline escalation and override report if time allows
7. Notification package (Step 6)
8. CLI end-to-end + live demo tuning (Step 9)
9. Akamai deploy (Step 10)
10. Strands layer only if time remains (Step 8)
