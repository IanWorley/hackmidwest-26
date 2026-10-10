---
inclusion: always
---

# Project Structure

```
closure-call/
├── config/
│   ├── thresholds.yaml       # defensible cutoffs + cited source per hazard
│   └── facility.yaml         # synthetic facility + employee/building roster seed
├── closure_call/
│   ├── nws_client.py         # live NWS ingestion (alerts/forecast/observations)
│   ├── signals/              # supplementary signals (airnow, state_dot, ...)
│   ├── models.py             # pydantic domain models
│   ├── roster.py             # building vs employee roster resolution
│   ├── threshold_engine.py   # graded posture + reasoning (deterministic)
│   ├── notifier.py           # recipient logic, message draft, channel routing
│   ├── decision_record.py    # auditable snapshot (what/when/why)
│   └── agents/               # OPTIONAL Strands orchestration (lazy import)
├── cli.py                    # end-to-end demo entrypoint
└── tests/
```

## Module responsibilities
- **nws_client.py** — the only module that talks to `api.weather.gov`. Returns normalized readings.
- **signals/** — each supplementary source implements the same `Signal` interface (`base.py`).
- **models.py** — single source of truth for domain types. Building roster and employee roster are
  **separate lists**; reconcile only in `roster.py`.
- **threshold_engine.py** — pure, deterministic posture logic. No network calls, no side effects.
  Easy to unit-test at each posture boundary.
- **notifier.py** — produces recipient list *with inclusion/exclusion rationale*, drafted message,
  and channel routing (urgency maps to NWS `urgency` field + employee prefs).
- **decision_record.py** — immutable, versioned, hash-stamped snapshots; supports replay.
- **agents/** — optional; wraps the above as `@tool` functions for a Strands orchestrator.

## Rules
- Keep `threshold_engine.py` free of I/O so it stays deterministic and testable.
- Do not let the optional `agents/` layer become a hard dependency of any core module.
- New supplementary signals go under `signals/` and implement the shared interface.
